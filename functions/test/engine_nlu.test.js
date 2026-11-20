"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { detectIntents, registerIntent, knownIntents } = require("../src/ai/engine/intents")
const E = require("../src/ai/engine/entities")

const NOW = Date.UTC(2026, 10, 14, 10, 0, 0) // Sat 14 Nov 2026 12:00 SAST
const top = (t) => (detectIntents(t)[0] || {}).id || null
const ex = (t, places = []) => E.extract(t, { now: new Date(NOW), places })

// ---------------------------------------------------------------- intent detection
test("every required intent is detected from a natural phrasing", () => {
  const cases = {
    find_attractions: "Show me attractions in Soweto", find_restaurants: "Where can I eat kota?", find_accommodation: "I need a place to stay",
    find_tour_guides: "Is there a tour guide available?", find_tours: "Any guided tours?", find_businesses: "Find local businesses and craft shops",
    discover_things: "What are some things to do in Soweto?", compare: "Compare Mandela House and the Hector Pieterson Museum", recommend: "Can you recommend a good place?",
    plan_trip: "Help me plan a trip to Soweto", build_itinerary: "Build me an itinerary for a full day", ask_place: "Tell me about Regina Mundi Church",
    ask_price: "How much is entry?", ask_hours: "What are the opening hours?", ask_services: "What services do they offer?", ask_directions: "How do I get to Vilakazi Street?",
    find_events: "What events are on this weekend?", booking_request: "I want to book a room", emergency: "I need an ambulance",
  }
  for (const [intent, text] of Object.entries(cases)) assert.equal(top(text), intent, `${intent}: "${text}"`)
})
test("the example message is detected as trip planning, and emergencies outrank everything", () => {
  assert.equal(top("I'm visiting Soweto tomorrow. I have R800 and enjoy history and local food. What can I do?"), "plan_trip")
  assert.equal(top("plan my day but first I need an ambulance"), "emergency")
})
test("detection is deterministic, returns every matching intent and nothing for noise", () => {
  const a = detectIntents("cheap restaurants, how much is entry?"), b = detectIntents("cheap restaurants, how much is entry?")
  assert.deepEqual(a, b); assert.ok(a.map((i) => i.id).includes("find_restaurants") && a.map((i) => i.id).includes("ask_price"))
  assert.deepEqual(detectIntents("qwertyuiop zxcv"), []); assert.deepEqual(detectIntents(""), []); assert.deepEqual(detectIntents(null), [])
})
test("the registry is extensible: a new intent can be registered without touching the detector", () => {
  assert.ok(!knownIntents().includes("find_pharmacy"))
  registerIntent({ id: "find_pharmacy", priority: 41, patterns: [{ re: /\bpharmac(y|ies)\b/, w: 6 }] })
  assert.equal(top("where is a pharmacy"), "find_pharmacy"); assert.throws(() => registerIntent({ id: 5 }))
})

// ---------------------------------------------------------------- entity extraction
test("example: R800, history and food, trip tomorrow are extracted and nothing else is invented", () => {
  const e = ex("I'm visiting Soweto tomorrow. I have R800 and enjoy history and local food. What can I do?")
  assert.deepEqual([e.budget.max, e.budget.currency, e.budget.kind], [800, "ZAR", "total"])
  assert.deepEqual(e.interests.sort(), ["food", "history"]); assert.equal(e.date.label, "tomorrow"); assert.equal(e.date.iso, "2026-11-15")
  assert.equal(e.party, null); assert.equal(e.duration, null); assert.equal(e.time, null); assert.deepEqual(e.places, [])
})
test("budget forms: max, range, per person, thousands, spaced digits", () => {
  assert.deepEqual([E.parseBudget("under R500").budget.kind, E.parseBudget("under R500").budget.max], ["max", 500])
  const r = E.parseBudget("between R200 - R400").budget; assert.deepEqual([r.kind, r.min, r.max], ["range", 200, 400])
  assert.equal(E.parseBudget("R150 per person").budget.perPerson, true)
  assert.equal(E.parseBudget("R1 200").budget.max, 1200); assert.equal(E.parseBudget("R2k").budget.max, 2000); assert.equal(E.parseBudget("500 rand").budget.max, 500)
  assert.equal(E.parseBudget("no money mentioned").budget, null)
})
test("other currencies are reported, never converted or guessed", () => {
  const e = ex("I have $50 for lunch"); assert.equal(e.budget, null); assert.deepEqual(e.unsupported, ["currency"])
})
test("party size, children, dates, times and durations", () => {
  assert.deepEqual([ex("a family of 4 with 2 kids").party.total, ex("a family of 4 with 2 kids").party.children], [4, 2])
  assert.equal(ex("just me").party.total, 1); assert.equal(ex("for 3 people").party.total, 3); assert.equal(ex("nothing here").party, null)
  assert.equal(ex("this weekend").date.kind, "weekend"); assert.equal(ex("next monday").date.iso, "2026-11-16"); assert.equal(ex("on 20 December").date.iso, "2026-12-20")
  assert.equal(ex("31 february").date, null); assert.equal(ex("yesterday 12 november").date.past, true)
  assert.deepEqual([ex("at 3pm").time.hour, ex("in the evening").time.part], [15, "evening"])
  assert.equal(ex("a half day").duration.kind, "half_day"); assert.equal(ex("3 days").duration.days, 3); assert.equal(ex("a full day").duration.kind, "full_day")
})
test("categories, interests, constraints and known places are recognised", () => {
  const e = ex("wheelchair accessible restaurants near me open now in Orlando West", ["Orlando West"])
  assert.ok(e.categories.includes("restaurants")); assert.deepEqual(e.places, ["Orlando West"])
  assert.deepEqual([e.constraints.accessible, e.constraints.nearMe, e.constraints.openNow], [true, true, true])
  assert.ok(ex("I love jazz and street art").interests.includes("music") && ex("I love jazz and street art").interests.includes("art"))
})
test("follow-up references are flagged", () => { assert.equal(ex("how much is the first one?").refersToPrevious, true); assert.equal(ex("restaurants in Diepkloof").refersToPrevious, false) })
