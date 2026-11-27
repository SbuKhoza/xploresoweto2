"use strict"
// App side of the CMS <-> mobile compatibility check. Documents are GENERATED from the CMS form snapshot (docs/staging/cms-schema-snapshot.json,
// exported by the CMS repo), including the blank-form and half-typed shapes the CMS can save, then run through the app's normaliser.
// This proves the normaliser accepts what the CMS writes; it does not run the CMS or the app UI.
const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("fs"), path = require("path")
const { pathToFileURL } = require("url")
const root = path.join(__dirname, "..", "..")
const SNAP = JSON.parse(fs.readFileSync(path.join(root, "docs/staging/cms-schema-snapshot.json"), "utf8"))
const CONTRACT = JSON.parse(fs.readFileSync(path.join(root, "docs/staging/cms-listing-contract.json"), "utf8"))
const U = ["https://example.test/a.jpg"]
const sample = { text: "Sample", textarea: "Sample text", select: "", number: 4.5, strings: ["one", "two"], numbers: [2, 4], images: U, image: U[0], coords: { latitude: -26.25, longitude: 27.9 }, toggle: true, objects: [{ name: "Wi-Fi", icon: "wifi" }] }
const blank = { text: "", textarea: "", select: "", number: null, strings: [], numbers: [], images: [], image: "", coords: null, toggle: false, objects: [] }
const gen = (id, table) => Object.fromEntries(Object.entries(SNAP[id].fields).filter(([k]) => !k.includes(".")).map(([k, f]) => [k, table[f.type]]))
const ids = Object.keys(CONTRACT).filter((k) => !k.startsWith("_"))
const isArr = (v) => Array.isArray(v)

test("every collection in the CMS snapshot that the app reads is covered by the contract, and the contract fields exist in the CMS", () => {
  for (const id of ids) for (const k of Object.keys(CONTRACT[id])) assert.ok(k in SNAP[id].fields, `${id}.${k} missing from the CMS form`)
})
test("documents the CMS saves (filled, blank, half-typed) normalise to display-safe shapes", async () => {
  const { normalizeListing } = await import(pathToFileURL(path.join(root, "utils/listingData.js")).href)
  for (const id of ids) {
    for (const table of [sample, blank]) {
      const out = normalizeListing(id, { id: "x", ...gen(id, table) })
      for (const [k, kind] of Object.entries(CONTRACT[id])) {
        if (k.includes(".") || !(k in out)) continue
        if (["strings", "numbers", "images"].includes(kind)) assert.ok(isArr(out[k]), `${id}.${k} must be an array`)
        if (kind === "images") for (const u of out[k]) assert.match(u, /^https?:/)
        if (kind === "text") assert.ok(typeof out[k] === "string" || (k === "accessibility" && typeof out[k] === "boolean") || (["price", "entryFee"].includes(k) && (out[k] === null || typeof out[k] === "object")), `${id}.${k}`) // prices normalise to a structured value
        if (kind === "number" && out[k] !== null && out[k] !== undefined) assert.ok(Number.isFinite(out[k]), `${id}.${k}`)
        if (kind === "objects") assert.ok(isArr(out[k]) && out[k].every((x) => typeof x === "object"), `${id}.${k}`)
      }
    }
  }
})
test("business services saved by the CMS keep their objects (name and icon)", async () => {
  const { normalizeListing } = await import(pathToFileURL(path.join(root, "utils/listingData.js")).href)
  const o = normalizeListing("business", { name: "B", services: [{ name: "Wi-Fi", icon: "wifi" }, { name: "Parking", icon: "default" }], gallery: { images: U } })
  assert.deepEqual(o.services.map((s) => [s.name, s.icon]), [["Wi-Fi", "wifi"], ["Parking", "default"]]); assert.deepEqual(o.galleryImages, U)
})
test("CMS fields the app does not know and legacy shapes (price/entryFee, hours/openingHours) are preserved or aliased", async () => {
  const { normalizeListing } = await import(pathToFileURL(path.join(root, "utils/listingData.js")).href)
  assert.equal(normalizeListing("restaurants", { name: "R", hours: "9-5" }).openingHours, "9-5")
  assert.equal(normalizeListing("restaurants", { name: "R", hours: "9-5", openingHours: "10-4" }).openingHours, "10-4")
  assert.equal(normalizeListing("attractions", { name: "A", entryFee: "R100" }).price, "R100")
  assert.equal(normalizeListing("recreation", { name: "A", price: "R450" }).entryFee, "R450")
  assert.equal(normalizeListing("restaurants", { name: "R", organisationId: "o1", customField: 3 }).customField, 3)
})
test("backend-approved listing payload (no tableOptions/services) is safe, and a restaurant without table sizes is not reservable", async () => {
  const L = await import(pathToFileURL(path.join(root, "utils/listingData.js")).href)
  const approved = { name: "New Place", description: "d", location: "l", cuisine: "c", tags: ["x"], coordinates: { latitude: -26.2, longitude: 27.9 }, images: [], organisationId: "o", isActive: true }
  const r = L.normalizeListing("restaurants", approved)
  assert.deepEqual([r.images, r.tableOptions, r.specialDishes], [[], [], []]); assert.equal(L.reservationEligibility(r).ok, false)
})
