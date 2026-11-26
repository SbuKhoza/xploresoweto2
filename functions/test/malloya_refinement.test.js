"use strict"
// Phase: conversational refinement. Social turns, references to shown listings, fewer/clearer bubbles, group budgets and price units.
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const F = require("./engine_fixture")
const { respond } = require("../src/ai/engine/engine")
const { stopCost, verdict } = require("../src/ai/engine/cost")
const { parsePrice } = require("../src/ai/retrieval/normalize")
const en = require("../src/ai/engine/locales/en")

let env
beforeEach(() => { env = F.setupWorld() })
const say = (message, context = null) => respond({ message, context, location: null, cfg: F.cfg, now: new Date(env.time.now) })
const text = (r) => r.blocks.map((b) => b.text).join("\n")
async function convo(...ms) { const out = []; let ctx = null; for (const m of ms) { const r = await say(m, ctx); out.push(r); ctx = r.context } return out }
const isFallback = (r) => r.intent === "unknown" || r.fallback === true || /didn't quite catch/i.test(text(r))
const wipe = () => { for (const col of ["restaurants", "accommodations", "attractions", "recreation", "business", "events", "homescreen"]) for (const d of env.list(col)) env.db.store.delete(`${col}/${d.id}`) }

// ---------------------------------------------------------------- A1 social turns
test("greetings and paraphrases are greetings, in English, South African English and isiZulu/Sesotho", async () => {
  for (const q of ["hey there", "howzit", "good morning Malloya", "sawubona", "heita", "molo", "hello!", "yo", "Hi Malloya", "hey", "dumela", "how are you?", "good afternoon", "greetings"]) {
    const r = await say(q); assert.equal(r.intent, "greeting", q); assert.ok(!isFallback(r), q); assert.ok(r.blocks.every((b) => b.type === "general"), q)
  }
  assert.equal(text(await say("hi")), en.greeting, "the greeting wording is pinned by the Luna template and must not drift")
})
test("gratitude and paraphrases are thanks; the pinned thanks wording is unchanged", async () => {
  for (const q of ["thank you so much", "thanks a lot", "cheers", "ngiyabonga", "siyabonga kakhulu", "appreciate it", "much appreciated", "thx", "lekker, thanks", "thanks!!", "that's really helpful, thanks", "ke a leboha"]) {
    const r = await say(q); assert.equal(r.intent, "thanks", q); assert.ok(!isFallback(r), q)
  }
  assert.equal(text(await say("thanks")), en.thanks)
})
test("farewells and paraphrases end the chat warmly with no listing and no follow-up chips", async () => {
  for (const q of ["bye", "goodbye", "see you later", "that's all", "I'm done", "hamba kahle", "sala kahle", "have a good one", "talk later", "ok bye thanks", "thanks, bye!", "good night", "take care"]) {
    const r = await say(q); assert.equal(r.intent, "farewell", q); assert.ok(!isFallback(r), q); assert.deepEqual(r.followUps, [], q); assert.equal(r.evidence.length, 0, q)
  }
})
test("acknowledgements are answered naturally and point to something useful, using what was just discussed", async () => {
  for (const q of ["ok", "okay", "cool", "great", "nice", "alright", "got it", "sounds good", "perfect", "sharp", "lekker", "ok cool", "no worries"]) { const r = await say(q); assert.equal(r.intent, "acknowledge", q); assert.ok(!isFallback(r), q); assert.ok(r.followUps.length >= 2, q) }
  const [, after] = await convo("where can I eat", "cool")
  assert.ok(after.followUps.includes("Where can I stay?")); assert.match(text(after), /anything else|plan/i)
  const [, plan] = await convo("plan a day", "ok")
  assert.match(text(plan), /interested in|budget/i, "a plain 'ok' while Malloya is waiting for plan details moves the plan on")
})
test("a request after a social phrase is answered; a social phrase never hides or replaces the request", async () => {
  const cases = [["Hi, where can I stay?", "find_accommodation"], ["hello malloya show me places to eat", "find_restaurants"], ["thanks, and what events are on?", "find_events"], ["ok great, where can I eat kota", "find_restaurants"], ["cheers! any museums?", "find_attractions"], ["sawubona, where can we stay"," find_accommodation".trim()]]
  for (const [q, intent] of cases) assert.equal((await say(q)).intent, intent, q)
  assert.equal((await say("thanks, I need an ambulance")).intent, "emergency")
})
test("ordinary words that merely resemble social phrases are not swallowed", async () => {
  for (const q of ["great restaurants in Orlando West", "cool places to visit", "evening events please", "right now what is open"]) assert.ok(!["greeting", "thanks", "farewell", "acknowledge"].includes((await say(q)).intent), q)
})

// ---------------------------------------------------------------- A2 references to what was shown
test("'the second one', 'last one', 'number 3', 'option two' and 'what about the third' resolve to the right listing", async () => {
  const first = await say("show me restaurants"); const names = first.evidence.map((e) => e.name); assert.ok(names.length >= 3)
  for (const [q, i] of [["tell me about the second one", 1], ["what about the last one", names.length - 1], ["tell me more about number 3", 2], ["how much is option two", 1], ["what about the third", 2], ["tell me about the first one", 0]]) {
    const r = await say(q, first.context); assert.ok(!isFallback(r), q); assert.ok(text(r).includes(names[i]), `${q} should be about ${names[i]}`)
  }
})
test("'which one would you recommend?' picks from what was just shown, honestly, and keeps the list for later references", async () => {
  const [list, pick, again] = await convo("show me restaurants", "Which one would you recommend?", "tell me about the second one")
  assert.equal(pick.intent, "pick_best"); assert.ok(list.evidence.map((e) => e.name).some((n) => text(pick).includes(n)))
  assert.match(text(pick), /not on a visit|stored/i); assert.ok(pick.blocks.some((b) => b.type === "verified" && b.refs.length === 1))
  assert.ok(text(again).includes(list.evidence[1].name), "the earlier list is still what 'the second one' means")
  const none = await say("which one would you recommend?"); assert.ok(!isFallback(none)); assert.deepEqual(none.evidence, []); assert.match(text(none), /haven't shown/)
})

// ---------------------------------------------------------------- A3-A5 context woven in; fewer bubbles; honest badges
test("user-provided context is woven into the answer: no separate 'still using' notice and nothing about it is labelled unverified", async () => {
  const [, r] = await convo("we're two people and we heard about vilakazi st", "Where can I stay?")
  assert.ok(!/Still using what you told me/.test(text(r))); assert.match(text(r), /Vilakazi Street/); assert.match(text(r), /2 of you/)
  const stay = await say("where can I stay for 2 people under R800", null); assert.ok(!stay.blocks.some((b) => b.type === "unverified" && /you told me/i.test(b.text)))
})
test("a listing answer is at most three bubbles, shows each fact once, and carries the 'From our listings' badge on listing facts only", async () => {
  const r = await say("show me places to eat")
  assert.ok(r.blocks.length <= 3, r.blocks.map((b) => b.type).join()); assert.equal(r.blocks.filter((b) => b.type === "verified").length, 1)
  const ratings = (text(r).match(/rated \d/g) || []).length; assert.ok(ratings <= r.evidence.length, "a rating is not repeated in the ranking reasons")
  for (const b of r.blocks) if (b.type === "verified") assert.ok(b.refs.length > 0)
  assert.ok(r.blocks.filter((b) => b.type === "general").every((b) => b.refs.length === 0))
})

// ---------------------------------------------------------------- A6-A8 group budgets and price units
test("cost model: per person x group, per group once, free is zero, rooms are assumed and stated, unknown stays a range", () => {
  const party = { total: 2 }
  assert.deepEqual(pick(stopCost({ priceMin: 100, priceMax: 100, unit: "per_person", party })), { lo: 200, hi: 200 })
  assert.deepEqual(pick(stopCost({ priceMin: 100, priceMax: 100, unit: "per_group", party })), { lo: 100, hi: 100 })
  assert.deepEqual(pick(stopCost({ priceMin: 50, priceMax: 50, unit: "free", party })), { lo: 0, hi: 0 })
  assert.deepEqual(pick(stopCost({ priceMin: 300, priceMax: 300, unit: "unknown", party })), { lo: 300, hi: 600 })
  assert.deepEqual(pick(stopCost({ priceMin: 80, priceMax: 150, unit: "unknown", party })), { lo: 80, hi: 300 })
  assert.deepEqual(pick(stopCost({ priceMin: 700, priceMax: 700, unit: "per_room", party: { total: 3 }, nights: 2, kind: "stay" })), { lo: 2800, hi: 2800 }) // 2 rooms x 2 nights
  assert.deepEqual(pick(stopCost({ priceMin: 700, priceMax: 700, unit: "per_night", party, nights: 2, kind: "stay" })), { lo: 1400, hi: 2800 })
  assert.deepEqual(pick(stopCost({ priceMin: 120, priceMax: 120, unit: "unknown", party: null })), { lo: 120, hi: 120 }, "a single traveller: nothing is ambiguous")
  assert.equal(stopCost({ priceMin: null, priceMax: null, unit: "unknown", party }).noPrice, true)
  function pick(c) { return { lo: c.lo, hi: c.hi } }
})
test("verdicts: only 'within' says a plan fits; unknown units and unpriced stops can never produce it", () => {
  assert.equal(verdict({ lo: 590, hi: 1180, budget: 800, unpriced: 0 }), "unclear"); assert.equal(verdict({ lo: 590, hi: 700, budget: 800, unpriced: 0 }), "within")
  assert.equal(verdict({ lo: 590, hi: 700, budget: 800, unpriced: 1 }), "within_listed"); assert.equal(verdict({ lo: 900, hi: 1200, budget: 800, unpriced: 0 }), "over"); assert.equal(verdict({ lo: 1, hi: 2, budget: null, unpriced: 0 }), null)
})
test("price units: stored `priceUnit`, `pricing.unit` and clear wording are read; anything else is 'unknown', never guessed", () => {
  assert.equal(parsePrice("R120 per person").unit, "per_person"); assert.equal(parsePrice("R100 pp").unit, "per_person"); assert.equal(parsePrice("R700 per night").unit, "per_night"); assert.equal(parsePrice("R90 per room").unit, "per_room")
  assert.equal(parsePrice("R250 per group").unit, "per_group"); assert.equal(parsePrice("Free entry").unit, "free"); assert.equal(parsePrice("R80 - R150").unit, "unknown"); assert.equal(parsePrice("R120", "per_person").unit, "per_person")
  assert.equal(parsePrice("R120", "nonsense; drop table").unit, "unknown"); assert.equal(parsePrice(null).unit, "unknown"); assert.equal(parsePrice("R120", "person").unitSource, "stored")
})
test("THE REPORTED CASE: R800 for two with listed prices of R590-R660 is NOT called affordable when the unit is unknown", async () => {
  wipe()
  env.seed("attractions/h1", { name: "Test Heritage Museum", description: "history museum", type: "Museum", price: "R300", isActive: true, location: "Orlando West" })
  env.seed("attractions/h2", { name: "Test History Walk", description: "history walking tour", type: "Tour", price: "R290", isActive: true, location: "Orlando West" })
  env.seed("restaurants/f1", { name: "Test Kasi Kitchen", description: "local food, kota", price: "R60", isActive: true, location: "Orlando West" })
  const r = await say("plan a day for 2 people with R800, I like history and food")
  const t = text(r)
  assert.ok(["plan_trip", "build_itinerary"].includes(r.intent))
  assert.ok(!/within your budget/i.test(t), "must not claim the plan fits"); assert.match(t, /can't promise this fits/i)
  assert.match(t, /whole group/); assert.match(t, /per person/); assert.match(t, /R6[0-9]{2}/); assert.match(t, /R1[ ,]?[0-9]{3}/)
  assert.match(t, /does not say whether the price is per person or for the whole group/)
  assert.ok(!r.blocks.some((b) => b.type === "verified" && /come to/.test(b.text)), "an unestablished total is not presented as a verified fact")
})
test("with stated units the same plan is established: per-person prices are multiplied by the group, per-group ones are not", async () => {
  wipe()
  env.seed("attractions/h1", { name: "Test Heritage Museum", description: "history museum", type: "Museum", price: "R100", priceUnit: "per_person", isActive: true, location: "Orlando West" })
  env.seed("attractions/h2", { name: "Test History Walk", description: "history walking tour", type: "Tour", price: "R150", pricing: { unit: "per_group" }, isActive: true, location: "Orlando West" })
  env.seed("restaurants/f1", { name: "Test Kasi Kitchen", description: "local food, kota", price: "R60 pp", isActive: true, location: "Orlando West" })
  const r = await say("plan a day for 2 people with R800, I like history and food"); const t = text(r)
  assert.match(t, /R470/); assert.match(t, /within your budget of R800/); assert.ok(r.blocks.some((b) => b.type === "verified" && /R470/.test(b.text)))
  assert.match(t, /per person/); assert.match(t, /per group/)
  const tight = await say("plan a day for 2 people with R300, I like history and food")
  assert.match(text(tight), /Removed Test Heritage Museum .* over your R300 budget/, "a stop that cannot fit even at the lowest reading is removed, and that is said")
  assert.match(text(tight), /R270, within your budget of R300/)
})
test("a stay is costed with the stated assumption, and unpriced stops stop the plan being called complete", async () => {
  wipe()
  env.seed("attractions/h1", { name: "Test Heritage Museum", description: "history museum", type: "Museum", price: "R100", priceUnit: "per_person", isActive: true })
  env.seed("attractions/h2", { name: "Test History Walk", description: "history walking tour", type: "Tour", isActive: true })
  env.seed("restaurants/f1", { name: "Test Kasi Kitchen", description: "local food", price: "R60", priceUnit: "per_person", isActive: true })
  env.seed("accommodations/s1", { name: "Test Guest House", description: "quiet", type: "Guest house", price: "R700", priceUnit: "per_room", isActive: true })
  const r = await say("plan 2 days for 3 people with R5000, I like history and food"); const t = text(r)
  assert.match(t, /assumed 2 rooms for 3 people/); assert.ok(!/R5[ ,]?000, but/.test(t) || /no listed price/.test(t))
  assert.match(t, /no listed price|No price is listed/)
})
test("budget-aware choice: with a tight budget Malloya prefers places that are established to fit over higher-ranked ones that are not", async () => {
  wipe()
  env.seed("attractions/a1", { name: "Test Grand Tour", description: "history tour", type: "Tour", price: "R400", isActive: true, rating: 4.9, ratingCount: 90 })
  env.seed("attractions/a2", { name: "Test Small Museum", description: "history museum", type: "Museum", price: "R80", priceUnit: "per_person", isActive: true, rating: 4.0, ratingCount: 10 })
  env.seed("restaurants/f1", { name: "Test Kasi Kitchen", description: "local food", price: "R60", priceUnit: "per_person", isActive: true })
  const r = await say("plan a day for 2 people with R500, I like history and food"); assert.match(text(r), /Test Small Museum/); assert.ok(!/can't promise/.test(text(r)))
})
