"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const F = require("./engine_fixture")
const { loadCategory } = require("../src/ai/retrieval/listings")
const { rank, WEIGHTS } = require("../src/ai/engine/ranking")
const { buildItinerary } = require("../src/ai/engine/itinerary")
const L = require("../src/ai/engine/lexicon")

let env, ctx
beforeEach(() => { env = F.setupWorld(); ctx = F.ctxFor(env) })
const load = async (c) => (await loadCategory(c, ctx)).items
const names = (r) => r.ranked.map((e) => e.item.model.name)

// ---------------------------------------------------------------- search, filtering, ranking
test("search filters by category terms: only matching records are returned, best match first", async () => {
  const r = rank(await load("restaurants"), { queryTerms: ["kota"], interestWords: {} })
  assert.deepEqual(names(r), ["Gogo's Kitchen"])
})
test("filtering by name, place, price range and rating works on stored fields", async () => {
  const items = await load("restaurants")
  assert.deepEqual(names(rank(items, { queryTerms: ["steakhouse"], interestWords: {} })), ["Pricey Steakhouse"])
  assert.equal(rank(items, { queryTerms: [], interestWords: {}, place: "Maponya" }).ranked[0].item.model.name, "Pricey Steakhouse") // place bonus puts it first
  const cheap = rank(items, { queryTerms: [], interestWords: {}, budgetMax: 200 }); assert.ok(!names(cheap).includes("Pricey Steakhouse")); assert.equal(cheap.excluded.overBudget, 1)
  const good = rank(items, { queryTerms: [], interestWords: {}, minRating: 4.5 }); assert.ok(!names(good).includes("Mama's Braai Spot")); assert.equal(good.excluded.belowRating, 1)
})
test("an unknown price is never treated as cheap, free or over budget: the record stays and is flagged", async () => {
  const r = rank(await load("restaurants"), { queryTerms: [], interestWords: {}, budgetMax: 200 })
  const mama = r.ranked.find((e) => e.item.model.name === "Mama's Braai Spot"); assert.ok(mama); assert.ok(mama.flags.includes("price_not_listed")); assert.ok(!mama.factors.some((f) => f.key === "budget"))
})
test("a missing rating earns no points and is flagged; it is not replaced by an average", async () => {
  const r = rank(await load("attractions"), { queryTerms: [], interestWords: {} })
  const regina = r.ranked.find((e) => e.item.model.name === "Regina Mundi Church"); assert.ok(!regina.flags.includes("no_rating")) // it has a rating in the fixture
  const bare = rank(await load("business"), { queryTerms: [], interestWords: {} }).ranked[0]; assert.ok(bare.flags.includes("no_rating")); assert.ok(!bare.factors.some((f) => f.key === "rating"))
})
test("ranking is explainable: every point comes from a named factor with a reason", async () => {
  const r = rank(await load("attractions"), { queryTerms: [], interestWords: { history: L.INTERESTS.history.words } })
  for (const e of r.ranked) { assert.ok(Math.abs(e.score - e.factors.reduce((n, f) => n + f.points, 0)) < 0.01); assert.ok(e.factors.length === 0 || e.reasons.length > 0); assert.ok(e.factors.every((f) => ["text", "interest", "rating", "distance", "budget", "place"].includes(f.key))) }
  assert.match(r.ranked[0].reasons.join(" "), /history/)
})
test("a record with 100 good reviews outranks one with a single 5-star review (Bayesian rating)", async () => {
  env.seed("attractions/z1", { name: "One Review Wonder", description: "museum history", isActive: true, rating: 5, reviews: 1 })
  const r = rank(await load("attractions"), { queryTerms: [], interestWords: { history: L.INTERESTS.history.words } })
  const order = names(r); assert.ok(order.indexOf("Hector Pieterson Museum") < order.indexOf("One Review Wonder"))
})
test("ranking is deterministic: identical inputs give identical order, ties break by name", async () => {
  env.seed("attractions/t1", { name: "Alpha Site", description: "x", isActive: true }); env.seed("attractions/t2", { name: "Beta Site", description: "x", isActive: true })
  const a = names(rank(await load("attractions"), { queryTerms: [], interestWords: {} })), b = names(rank(await load("attractions"), { queryTerms: [], interestWords: {} }))
  assert.deepEqual(a, b); assert.ok(a.indexOf("Alpha Site") < a.indexOf("Beta Site"))
})
test("NO PAID PLACEMENT: owning an organisation, a subscription or a 'featured' flag changes nothing", async () => {
  const base = { name: "Twin Cafe", description: "kota", location: "Orlando", isActive: true, rating: 4, reviews: 10 }
  env.seed("restaurants/p1", { ...base, name: "Twin Cafe A" }); env.seed("restaurants/p2", { ...base, name: "Twin Cafe B", organisationId: "orgA", featured: true, promoted: true, sponsored: true, plan: "premium", paid: true, boost: 99 })
  const r = rank(await load("restaurants"), { queryTerms: ["kota", "twin"], interestWords: {} })
  const a = r.ranked.find((e) => e.item.model.name === "Twin Cafe A"), b = r.ranked.find((e) => e.item.model.name === "Twin Cafe B")
  assert.equal(a.score, b.score); assert.deepEqual(a.factors, b.factors)
})
test("distance is used only when the user shared a location and the record has coordinates; otherwise it is flagged", async () => {
  const noLoc = rank(await load("attractions"), { queryTerms: [], interestWords: {}, useDistance: false }); assert.ok(noLoc.ranked.every((e) => !e.factors.some((f) => f.key === "distance")))
  const c2 = F.ctxFor(env, { location: { latitude: -26.23, longitude: 27.906 } }), items = (await loadCategory("attractions", c2)).items
  const r = rank(items, { queryTerms: [], interestWords: {}, useDistance: true })
  assert.ok(r.distanceNote); assert.ok(r.ranked.find((e) => e.item.model.name === "Regina Mundi Church").flags.includes("no_coordinates"))
  assert.ok(r.ranked.find((e) => e.item.model.name === "Hector Pieterson Museum").factors.some((f) => f.key === "distance"))
})
test("weights are frozen and documented in one place", () => { assert.ok(Object.isFrozen(WEIGHTS)); assert.ok(Object.values(WEIGHTS).every((v) => typeof v === "number")) })

// ---------------------------------------------------------------- itinerary
const pools = async () => ({
  activity: rank([...(await load("attractions")), ...(await load("recreation"))], { queryTerms: [], interestWords: {} }).ranked,
  meal: rank(await load("restaurants"), { queryTerms: [], interestWords: {} }).ranked, stay: rank(await load("accommodations"), { queryTerms: [], interestWords: {} }).ranked,
})
test("half-day, full-day and multi-day plans have the right shape and never repeat a place", async () => {
  const p = await pools()
  const half = buildItinerary({ duration: { kind: "half_day", days: 0.5 }, pools: p }), full = buildItinerary({ duration: { kind: "full_day", days: 1 }, pools: p }), multi = buildItinerary({ duration: { kind: "multi_day", days: 2 }, pools: p })
  assert.deepEqual([half.dayCount, half.days[0].stops.length], [1, 2]); assert.deepEqual([full.dayCount, full.days[0].stops.length], [1, 3]); assert.equal(multi.dayCount, 2)
  const refs = multi.days.flatMap((d) => d.stops.map((s) => s.ref)); assert.equal(new Set(refs).size, refs.length)
  assert.ok(multi.stay && multi.stay.name) // multi-day suggests a stay; one-day does not
  assert.equal(full.stay, null)
})
test("a missing duration is an ASSUMPTION that is stated, and the plan is never called feasible", async () => {
  const plan = buildItinerary({ duration: null, pools: await pools() })
  assert.equal(plan.feasibility, "unverified"); assert.ok(plan.assumptions.some((a) => /No length of visit/.test(a))); assert.ok(plan.caveats.some((c) => /can't verify travel times/.test(c)))
})
test("budget: stops are removed from the priciest down using LISTED prices only; unknown prices are never counted as free", async () => {
  const p = await pools()
  const plan = buildItinerary({ duration: { kind: "full_day", days: 1 }, budget: { max: 150, kind: "total" }, pools: p })
  assert.ok(plan.totals.knownCostMin <= 150); assert.ok(["within", "within_listed"].includes(plan.totals.verdict)); assert.equal(plan.totals.verdict === "within", plan.totals.unknownPriceCount === 0) // affordable places are now preferred up front, so fewer (or no) stops need removing
  const unknown = plan.days.flatMap((d) => d.stops).filter((s) => !s.priceKnown)
  if (unknown.length) assert.ok(plan.caveats.some((c) => c.includes(unknown[0].name) && /No price is listed/.test(c)))
})
test("empty pools give an honest empty plan with a stated reason, not invented stops", () => {
  const plan = buildItinerary({ duration: { kind: "full_day", days: 1 }, pools: { activity: [], meal: [], stay: [] } })
  assert.equal(plan.days.flatMap((d) => d.stops).length, 0); assert.deepEqual(plan.missing.sort(), ["activity", "meal"]); assert.ok(plan.caveats.some((c) => /No suitable records/.test(c)))
})
test("multi-day plans are capped, and the cap is stated", async () => {
  const plan = buildItinerary({ duration: { kind: "multi_day", days: 10 }, pools: await pools() })
  assert.equal(plan.dayCount, 5); assert.ok(plan.assumptions.some((a) => /first 5 days/.test(a)))
})
test("straight-line gaps appear only between stops that both have coordinates, and are labelled approximate", async () => {
  const plan = buildItinerary({ duration: { kind: "full_day", days: 1 }, pools: await pools() })
  const withGap = plan.days.flatMap((d) => d.stops).filter((s) => s.approxKmFromPrevious !== null)
  assert.ok(plan.distanceNote === null || /not driving distance or travel time/.test(plan.distanceNote)); assert.ok(withGap.every((s) => typeof s.approxKmFromPrevious === "number"))
})
