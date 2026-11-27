"use strict"
// Pure tests for the app's listing normalisation (utils/listingData.js) and static guards over the listing screens.
// (React Native cannot run under node --test; screen RENDERING is covered by tests/ui, which is opt-in because it needs its own dev dependencies.)
const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("fs"), path = require("path")
const { pathToFileURL } = require("url")
const root = path.join(__dirname, "..", "..")
const load = (f) => import(pathToFileURL(path.join(root, f)).href)
const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
const U = "https://example.test/a.jpg", U2 = "https://example.test/b.jpg"

test("images: only usable URLs, never an invented one, [''] and junk give an empty list", async () => {
  const L = await load("utils/listingData.js")
  assert.deepEqual(L.toImageList([U, U2]), [U, U2])
  for (const bad of [undefined, null, "", [], [""], [null, 5, {}, "nope", "ftp://x/y.jpg", "javascript:alert(1)"], 7, true, {}]) assert.deepEqual(L.toImageList(bad), [], JSON.stringify(bad))
  assert.deepEqual(L.toImageList(U), [U], "a bare URL string is accepted")
  assert.deepEqual(L.toImageList([U, U, { url: U2 }, { uri: U }, { src: "https://x.test/c.png" }]), [U, U2, "https://x.test/c.png"], "duplicates removed, {url|uri|src} objects accepted")
  assert.deepEqual(L.toImageList(["data:image/png;base64,AAAA", "file:///a/b.jpg"]).length, 2)
})

test("text, numbers, ratings and counts", async () => {
  const L = await load("utils/listingData.js")
  assert.equal(L.toText("  hi "), "hi"); assert.equal(L.toText(5), "5")
  for (const bad of [null, undefined, {}, [], NaN, Infinity, true]) assert.equal(L.toText(bad), "")
  assert.equal(L.toRating("4.5"), 4.5); assert.equal(L.toRating(0), 0); for (const bad of ["x", 6, -1, null, undefined, {}, NaN]) assert.equal(L.toRating(bad), null)
  assert.equal(L.toCount("12"), 12); assert.equal(L.toCount(0), 0); for (const bad of [-1, "x", null, {}]) assert.equal(L.toCount(bad), null)
  assert.equal(L.toPositiveInt("4"), 4); for (const bad of [0, -2, "x", null, 0.5]) assert.equal(L.toPositiveInt(bad), null)
})

test("coordinates: finite, in range; strings and lat/lng aliases accepted; junk is null (no invented location)", async () => {
  const L = await load("utils/listingData.js")
  assert.deepEqual(L.toCoordinates({ latitude: -26.2, longitude: 27.9 }), { latitude: -26.2, longitude: 27.9 })
  assert.deepEqual(L.toCoordinates({ latitude: "-26.2", longitude: "27.9" }), { latitude: -26.2, longitude: 27.9 })
  assert.deepEqual(L.toCoordinates({ lat: -26.2, lng: 27.9 }), { latitude: -26.2, longitude: 27.9 })
  for (const bad of [null, undefined, "-26,27", [], {}, { latitude: 91, longitude: 0 }, { latitude: 1, longitude: 181 }, { latitude: "x", longitude: 1 }, { latitude: 0, longitude: 0 }, { latitude: null, longitude: null }]) assert.equal(L.toCoordinates(bad), null, JSON.stringify(bad))
})

test("prices: legacy text kept as written; numbers and bare numeric text get R; ranges are not one amount", async () => {
  const L = await load("utils/listingData.js")
  assert.equal(L.formatPrice("R700"), "R700"); assert.equal(L.formatPrice(700), "R700"); assert.equal(L.formatPrice("700"), "R700"); assert.equal(L.formatPrice("R80 - R150"), "R80 - R150"); assert.equal(L.formatPrice("Free"), "Free")
  for (const bad of [null, undefined, "", {}, [], -5, NaN]) assert.equal(L.formatPrice(bad), null)
  assert.equal(L.formatEntryFee(0), "Free"); assert.equal(L.formatEntryFee("0"), "Free"); assert.equal(L.formatEntryFee("R100"), "R100"); assert.equal(L.formatEntryFee(null), null)
  assert.equal(L.priceAmount("R700"), 700); assert.equal(L.priceAmount(700), 700); assert.equal(L.priceAmount("R80 - R150"), null); assert.equal(L.priceAmount(null), null)
})

test("lists: tags/dishes/amenities keep valid entries, drop invalid ones, split a legacy comma string", async () => {
  const L = await load("utils/listingData.js")
  assert.deepEqual(L.toStringList(["a", " b ", null, 3, {}, { name: "c" }, [], ""]), ["a", "b", "3", "c"])
  assert.deepEqual(L.toStringList("kota, family\npap"), ["kota", "family", "pap"])
  for (const bad of [undefined, null, 5, {}, true]) assert.deepEqual(L.toStringList(bad), [])
})

test("table options: only real positive whole table sizes, nothing invented", async () => {
  const L = await load("utils/listingData.js")
  assert.deepEqual(L.toTableOptions([2, "4", 4, 0, -1, "x", null, 2.5, 6]), [2, 4, 6]); assert.deepEqual(L.toTableOptions("2,4 6"), [2, 4, 6])
  for (const bad of [undefined, null, {}, 5, true, []]) assert.deepEqual(L.toTableOptions(bad), [])
  assert.equal(L.reservationEligibility({ id: "r1", tableOptions: [2] }).ok, true)
  assert.equal(L.reservationEligibility({ id: "r1" }).ok, false); assert.match(L.reservationEligibility({ id: "r1", tableOptions: [] }).reason, /table options/)
  assert.equal(L.reservationEligibility({ tableOptions: [2] }).ok, false, "no id → no request"); assert.equal(L.reservationEligibility(null).ok, false)
})

test("business services: objects keep their fields, strings become {name}, invalid entries dropped", async () => {
  const L = await load("utils/listingData.js")
  assert.deepEqual(L.toServices([{ name: "Haircut", price: "R50", icon: "cut" }, "Braids", null, 4, {}, { icon: "x" }, { title: "T" }]), [{ name: "Haircut", price: "R50", icon: "cut" }, { name: "Braids" }, { name: "4" }, { title: "T", name: "T" }])
  assert.deepEqual(L.toServices("Cuts, Colour"), [{ name: "Cuts" }, { name: "Colour" }]); assert.deepEqual(L.toServices({ a: 1 }), []); assert.deepEqual(L.toServices(null), [])
})

test("transport: mode is never defaulted; stops and departures are cleaned, never generated", async () => {
  const L = await load("utils/listingData.js")
  assert.equal(L.toMode(" TRAIN "), "train"); for (const bad of [undefined, null, {}, [], 5]) assert.equal(L.toMode(bad === 5 ? {} : bad), "")
  assert.deepEqual(L.toDepartures(["05:00", { time: "06:00" }, null, 7, {}, ""]), ["05:00", "06:00", "7"]); assert.deepEqual(L.toDepartures("05:00, 06:00"), ["05:00", "06:00"]); assert.deepEqual(L.toDepartures(null), [])
  assert.deepEqual(L.toStops([null, { name: "A" }, "B", {}]), ["A", "B"]); assert.deepEqual(L.toStops(undefined), [])
  const r = L.normalizeListing("transport", { id: "t", routeName: "R" }); assert.equal(r.mode, ""); assert.deepEqual(r.departures, []); assert.deepEqual(r.stops, [])
})

test("normalizeListing: valid data is preserved, other fields pass through, nothing throws", async () => {
  const L = await load("utils/listingData.js")
  const good = { id: "r1", name: "Kitchen", description: "d", location: "l", type: "Braai", cuisine: "Braai", price: "R80 - R150", openingHours: "08:00 - 17:00", rating: 4.5, reviews: 10, images: [U], tags: ["a"], specialDishes: ["b"], tableOptions: [2, 4], coordinates: { latitude: -26.2, longitude: 27.9 }, isActive: true, organisationId: "o1", customField: { keep: 1 } }
  assert.deepEqual(L.normalizeListing("restaurants", good), good, "a complete valid document is unchanged")
  for (const col of L.LISTING_COLLECTIONS) for (const bad of [null, undefined, 5, "x", [], {}, { id: "x", name: {}, images: 5, tags: 5, coordinates: 5, rating: {}, reviews: [], services: 5, stops: 5, departures: {} }]) assert.doesNotThrow(() => L.normalizeListing(col, bad), `${col} ${JSON.stringify(bad)}`)
  assert.deepEqual(L.normalizeListings("restaurants", [good, null, 5, "x"]).map((d) => d.id), ["r1"]); assert.deepEqual(L.normalizeListings("restaurants", null), [])
})

test("collection specifics: attractions/recreation accept price OR entryFee; business merges the CMS gallery.images; public service accessibility text", async () => {
  const L = await load("utils/listingData.js")
  assert.equal(L.normalizeListing("attractions", { entryFee: "R100" }).price, "R100"); assert.equal(L.normalizeListing("recreation", { price: "R450" }).entryFee, "R450")
  const b = L.normalizeListing("business", { images: [U], gallery: { images: [U2, U, ""] } }); assert.deepEqual(b.images, [U]); assert.deepEqual(b.galleryImages, [U, U2])
  for (const [v, want] of [["No", false], ["false", false], ["Not accessible", false], ["", false], [undefined, false], ["Yes", true], ["Ramp at entrance", true], [true, true], [false, false]]) assert.equal(L.normalizeListing("publicservice", { accessibility: v }).accessibility, want, String(v))
  assert.equal(L.normalizeListing("healthcare", { emergency: "yes" }).emergency, true); assert.equal(L.normalizeListing("healthcare", { emergency: "no" }).emergency, false)
})

test("reviews: dates from Timestamps, invalid ratings ignored in the average", async () => {
  const L = await load("utils/listingData.js")
  const d = L.toDate({ toDate: () => new Date("2026-01-02T00:00:00Z") }); assert.ok(d instanceof Date); assert.equal(L.toDate("nope"), null); assert.equal(L.toDate({ seconds: 1767312000 }) instanceof Date, true)
  assert.equal(L.averageRating([{ rating: 5 }, { rating: 4 }, { rating: "x" }, null, {}]), 4.5); assert.equal(L.averageRating([]), 0); assert.equal(L.averageRating(null), 0)
  assert.deepEqual(L.toReview({ id: "1", reviewerName: 5, rating: 9, comment: {}, createdAt: "bad" }), { id: "1", reviewerName: "5", rating: null, comment: "", createdAt: null })
})

test("diagnostics contain no document data", async () => {
  const L = await load("utils/listingData.js")
  const s = L.safeErrorSummary(Object.assign(new TypeError("x ".repeat(200)), { doc: { secret: 1 } }))
  assert.equal(s.name, "TypeError"); assert.ok(s.message.length <= 160); assert.deepEqual(Object.keys(s).sort(), ["message", "name"])
})

test("townships: names, text, images and aliases are validated", async () => {
  const T = await load("utils/townships.js")
  const i = T.getTownshipInfo({ id: "t1", name: "Orlando", area: { a: 1 }, tagline: 5, imageUrl: "nope", aliases: ["O", null, 7, {}], history: [{ year: 1930, text: "Founded" }, { text: {} }, null, "plain"], people: [{ name: { a: 1 } }, { name: "Person", role: 5 }], landmarks: [{ name: "Tower", text: [] }, null], facts: [null, "fact", { text: 4 }] }, 0)
  assert.equal(i.name, "Orlando"); assert.equal(i.area, ""); assert.equal(i.tagline, "5"); assert.equal(i.imageUrl, null); assert.deepEqual(i.aliases, ["O", "7"])
  assert.deepEqual(i.history, [{ year: "1930", text: "Founded" }, { text: "plain" }]); assert.deepEqual(i.people.map((p) => p.name), ["Person"]); assert.deepEqual(i.landmarks.map((l) => l.name), ["Tower"]); assert.deepEqual(i.facts, ["fact", "4"])
  for (const bad of [null, undefined, 5, [], "Name"]) assert.doesNotThrow(() => T.getTownshipInfo(bad, 0))
})

test("static guard: the listing screens never call array methods directly on listing fields that may be missing", () => {
  const screens = ["Restaurants", "Business", "Transport", "Accommodation", "Attraction", "Recreation", "Healthcare", "PublicService", "Emergency"].map((n) => [n, read(`components/xplorescreens/${n}.js`)])
  // (field)(optional chain or not).(map|slice|forEach|filter|length-based indexing) applied straight to a raw document field
  const raw = /\b(?:selectedRestaurant|selectedBusiness|item|b|r|s|h|a)\.(images|tags|specialDishes|services|amenities|stops|departures|tableOptions)\??\.(map|slice|forEach)\(/g
  const NORMALISED = new Set(["Restaurants", "Business", "Transport", "Emergency"]) // these read arrays produced by normalizeListing(); the others go through ExploreList, which normalises
  for (const [name, src] of screens) {
    const hits = [...src.matchAll(raw)].map((m) => m[0])
    if (!NORMALISED.has(name)) assert.deepEqual(hits, [], `${name} calls an array method directly on a raw field`)
    if (NORMALISED.has(name)) assert.match(src, /normalizeListing/, `${name} must normalise its documents`)
  }
  assert.match(read("components/xplorescreens/shared/ExploreList.js"), /normalizeListing\(collectionName/, "ExploreList normalises every document for its collection")
  assert.doesNotMatch(read("components/xplorescreens/Restaurants.js"), /selectedRestaurant\.images\.map/, "the crash at Restaurants.js (images.map on undefined)")
  assert.doesNotMatch(read("components/xplorescreens/Transport.js"), /\|\| *"bus"\)/, "a missing transport mode must not default to bus")
})

test("static guard: every listing screen is wrapped in the scoped error boundary; diagnostics log no documents", () => {
  const app = read("App.js")
  for (const n of ["Accommodation", "Restaurants", "Emergency", "Recreation", "Attraction", "Transport", "Business", "Healthcare", "PublicService", "SowetoTownships"]) assert.match(app, new RegExp(`<ListingErrorBoundary screen="${n}"><${n} /></ListingErrorBoundary>`), n)
  const b = read("components/ListingErrorBoundary.js"); assert.match(b, /safeErrorSummary/); assert.doesNotMatch(b, /componentStack|errorInfo|JSON\.stringify/, "no component stack or serialised data in diagnostics")
})
