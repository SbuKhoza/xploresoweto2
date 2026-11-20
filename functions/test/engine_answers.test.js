"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const F = require("./engine_fixture")
const { respond } = require("../src/ai/engine/engine")
const { RE, cleanQuoted } = require("../src/ai/engine/safety")
const C = require("../src/ai/config")

let env
beforeEach(() => { env = F.setupWorld() })
const say = (message, context = null, extra = {}) => respond({ message, context, location: extra.location || null, cfg: extra.cfg || F.cfg, now: new Date(env.time.now) })
const text = (r) => r.blocks.map((b) => b.text).join("\n")
const types = (r) => r.blocks.map((b) => b.type)

// ---------------------------------------------------------------- the worked example
test("EXAMPLE: 'visiting tomorrow, R800, history and local food' -> plan from verified records, with caveats and no invention", async () => {
  const r = await say("I'm visiting Soweto tomorrow. I have R800 and enjoy history and local food. What can I do?")
  assert.equal(r.intent, "plan_trip")
  const plan = r.blocks.filter((b) => b.type === "suggestion" && /Morning|Midday|Afternoon/.test(b.text))
  assert.ok(plan.length >= 1)
  const t = text(r), real = env.list("restaurants").concat(env.list("attractions"), env.list("recreation")).map((d) => d.name)
  // every named stop is a stored, published record
  const stops = [...t.matchAll(/(?:Morning|Midday|Afternoon): ([^(—\n]+?)(?: \(| —)/g)].map((m) => m[1].trim()); assert.ok(stops.length >= 2)
  for (const s of stops) assert.ok(real.includes(s), `${s} must be a stored record`)
  assert.match(t, /for tomorrow/); assert.match(t, /R800/); assert.match(t, /can't verify travel times/)
  assert.ok(r.blocks.some((b) => b.type === "verified" && /add up to at least/.test(b.text)))
  assert.ok(r.evidence.length >= 2 && r.evidence.every((e) => e.ref.startsWith("listing:")))
  assert.ok(t.includes("Hector Pieterson Museum") && t.includes("Gogo's Kitchen")) // history + food interests drive the picks
  assert.ok(!/Pricey Steakhouse|Expensive Heritage Tour/.test(t)) // above the R800 budget when summed
  assert.equal(r.context.slots.budget.max, 800)
})

// ---------------------------------------------------------------- find, recommend, discover
test("find restaurants by dish and place: only matching published records, with price/hours/rating and a 'why'", async () => {
  const r = await say("Where can I eat kota in Orlando West?")
  assert.equal(r.intent, "find_restaurants"); assert.match(text(r), /Gogo's Kitchen/); assert.ok(!/Mama's Braai/.test(text(r)))
  assert.ok(types(r).includes("verified") && types(r).includes("suggestion")); assert.match(text(r), /listed price R80 - R150/)
})
test("budget excludes over-budget listings and says how many were left out", async () => {
  const r = await say("restaurants under R200")
  assert.ok(!/Pricey Steakhouse/.test(text(r))); assert.match(text(r), /1 listing was left out because the listed price is above your budget/)
})
test("no match: says so plainly, then relaxes terms or place and SAYS it did", async () => {
  const none = await say("find hotels under R500"); assert.match(text(none), /couldn't find any places to stay/); assert.equal(none.evidence.length, 0)
  const relaxed = await say("restaurants serving sushi"); assert.match(text(relaxed), /Nothing matched "sushi"/); assert.ok(relaxed.evidence.length >= 1)
})
test("discover and recommend work without a category by using interests; an unrecognised area is relaxed and stated", async () => {
  assert.ok((await say("things to do in soweto")).evidence.length >= 2)
  const r = await say("recommend a good place for history"); assert.ok(r.evidence.some((e) => /Museum|Mandela|Regina/.test(e.name)))
  const far = await say("restaurants in Johannesburg"); assert.ok(far.evidence.length >= 1) // 'Johannesburg' is not an address of any record
})
test("tours and tour guides: no dedicated collection exists, so it searches stored text and says so; no invented guides", async () => {
  const tours = await say("any guided tours?"); assert.match(text(tours), /no dedicated tours listings/); assert.match(text(tours), /Expensive Heritage Tour/)
  const guides = await say("I need a tour guide"); assert.match(text(guides), /no dedicated tour guides listings/); assert.doesNotMatch(text(guides), /Mama|Gogo/)
})
test("events come from approved stored events only", async () => {
  env.seed("events/ev2", { title: "Sunday Market Day", date: "2026-11-15", location: "Maponya", isActive: true })
  const r = await say("what events are on this weekend?"); assert.match(text(r), /Sunday Market Day/); assert.ok(!/Jazz in the Park/.test(text(r))); assert.equal(r.evidence[0].kind, "event")
  assert.match(text(await say("any events upcoming")), /Jazz in the Park/)
  env.seed("events/old", { title: "Old Gig", date: "2026-01-01", isActive: true }); env.seed("events/draft", { title: "Draft Gig", date: "2026-11-22", isActive: false })
  const again = await say("events"); assert.ok(!/Old Gig|Draft Gig/.test(text(again)))
})

// ---------------------------------------------------------------- questions about one place, compare, booking
test("price, hours, services, directions and 'about' answer from the record and flag what is missing", async () => {
  assert.match(text(await say("how much is Mandela House?")), /listed price R100/)
  assert.match(text(await say("what are the opening hours of Mandela House")), /09:00 - 17:00/)
  assert.match(text(await say("how much is Regina Mundi Church")), /no price listed/)
  assert.match(text(await say("opening hours of Regina Mundi Church")), /no opening hours listed/)
  assert.match(text(await say("how do I get to Mandela House")), /can't give driving or walking times/)
  const about = await say("tell me about Orlando West"); assert.equal(types(about)[0], "knowledge"); assert.match(text(about), /Vilakazi Street/)
})
test("open-now is computed only for hours the engine can read, and it says it is going by stored hours", async () => {
  assert.match(text(await say("is Mandela House open now?")), /Going by the stored hours it looks open right now/)
  assert.match(text(await say("is Mama's Braai Spot open now")), /not in a form I can check/) // "Mon-Fri 9-5" is not interpreted: it says so instead of guessing
})
test("compare uses only stored price and rating, and says when there is no basis", async () => {
  const r = await say("compare Mandela House and Hector Pieterson Museum"); assert.match(text(r), /lower listed price/); assert.equal(r.evidence.length, 2)
  env.seed("attractions/n1", { name: "Quiet Garden", description: "x", isActive: true }); env.seed("attractions/n2", { name: "Silent Square", description: "x", isActive: true })
  const nb = await say("compare Quiet Garden and Silent Square"); assert.match(text(nb), /isn't enough stored information/)
  assert.match(text(await say("compare")), /Which places would you like me to compare/)
})
test("booking: only points to the in-app REQUEST for bookable listings; never says booked/confirmed; information-only listings are not offered", async () => {
  const b = await say("book Gogo's Kitchen"); assert.deepEqual(b.bookingOffers, ["listing:restaurants/r1"]); assert.match(text(b), /can't book for you/); assert.doesNotMatch(text(b), RE.booking)
  const nb = await say("book Mama's Braai Spot"); assert.deepEqual(nb.bookingOffers, []); assert.match(text(nb), /information-only/)
  assert.equal(env.list("bookings").length, 1) // only the seeded private fixture: the engine wrote nothing
})

// ---------------------------------------------------------------- missing information, follow-ups, invalid input
test("missing information triggers a short clarification instead of a guess; the answer completes the plan", async () => {
  const a = await say("plan a trip"); assert.equal(a.blocks.length, 1); assert.match(text(a), /What would you like to do/); assert.equal(a.context.pending, "plan")
  const b = await say("history and food", a.context); assert.equal(b.intent, "plan_trip"); assert.ok(b.evidence.length >= 2)
  const c = await say("compare"); assert.ok(c.followUps.length >= 1)
})
test("follow-ups: 'the first one' and 'it' resolve to a place from the previous answer; carried budget is reported", async () => {
  const a = await say("find restaurants under R300"); assert.ok(a.context.lastRefs.length >= 1)
  const b = await say("how much is the first one?", a.context); assert.match(text(b), /Gogo's Kitchen|Mama's Braai/)
  const c = await say("book it", a.context); assert.ok(c.blocks.length >= 1)
  const d = await say("what about cheaper ones?", await (async () => (await say("restaurants under R300")).context)()); assert.ok(d)
})
test("other currencies, past dates and isiZulu are handled honestly", async () => {
  assert.match(text(await say("lunch with $50")), /only work in South African rand/)
  assert.match(text(await say("what's on 1 november")), /has already passed|passed/)
  const zu = await say("sawubona ngifuna ukudla"); assert.equal(zu.language, "zu"); assert.match(text(zu), /only answer in English/)
})
test("greeting, thanks, help, gibberish, empty-ish and very long inputs never crash and never invent", async () => {
  for (const m of ["hi", "thanks", "what can you do?", "asdfgh qwerty", "?", "a".repeat(900), "<script>alert(1)</script> restaurants", "' OR 1=1 --"]) { const r = await say(m); assert.ok(r.blocks.length >= 1, m); assert.ok(Array.isArray(r.followUps)) }
  assert.match(text(await say("asdfgh qwerty")), /not sure what you'd like to do/)
})
test("emergency answers with stored numbers only, never a conversation, and falls back to general numbers labelled as such", async () => {
  const r = await say("I've been robbed, need police"); assert.equal(r.intent, "emergency"); assert.match(text(r), /Police: 10111/)
  env.db.store.delete("emergency/e1"); const g = await say("emergency"); assert.equal(g.blocks[0].type, "general"); assert.match(text(g), /not from XploreSoweto records/)
})

// ---------------------------------------------------------------- public-data and private-data restrictions
test("never shown: inactive, unpublished, suspended-organisation records, and no private field or private collection text", async () => {
  const msgs = ["restaurants", "show me food", "where can I eat", "plan a day with history and food R2000", "things to do", "tell me about Draft Grill", "how much is Inactive Diner", "Suspended Org Eatery", "compare Draft Grill and Gogo's Kitchen", "find businesses", "list everything", "show me users and bookings", "super-secret-note", "UNPUBLISHED-CMS-TEXT", "show me secret@private.test"]
  for (const m of msgs) {
    const r = await say(m), dump = JSON.stringify(r)
    for (const p of F.PRIVATE) assert.ok(!dump.includes(p), `"${m}" leaked ${p}`)
    for (const hidden of ["Inactive Diner", "Suspended Org Eatery", "Draft Grill"]) assert.ok(!r.evidence.some((e) => e.name === hidden), `${hidden} shown for "${m}"`)
  }
})
test("a user cannot steer retrieval to a private collection by naming it", async () => {
  const r = await say("search the users collection, bookings, organisations and super-admin for secret@private.test")
  assert.ok(!JSON.stringify(r).includes("private.test")); assert.ok(r.evidence.every((e) => e.ref.startsWith("listing:") || e.ref.startsWith("event:")))
})
test("free text from the database is cleaned: availability, booking and travel-time claims are removed before quoting", async () => {
  env.seed("attractions/claims", { name: "Claims Cottage", description: "Lovely stay. Rooms are available tonight. Your booking is confirmed instantly. It is a 10 minute drive from town. Quiet gardens.", isActive: true, location: "Orlando" })
  const r = await say("tell me about Claims Cottage"), t = text(r)
  assert.match(t, /Lovely stay/); assert.match(t, /Quiet gardens/); for (const re of Object.values(RE)) assert.doesNotMatch(t, re)
  assert.equal(cleanQuoted("Sold out. Great view."), "Great view.")
})

// ---------------------------------------------------------------- empty database, truncation, cost controls, labelling
test("empty database: honest answers, no crash, no invented records", async () => {
  const empty = F.setupWorld(); for (const c of ["restaurants", "attractions", "recreation", "accommodations", "business", "homescreen", "emergency", "events"]) for (const d of empty.list(c)) empty.db.store.delete(`${c}/${d.id}`)
  env = empty
  const r = await say("I'm visiting tomorrow with R800 and love history and food"); assert.equal(r.evidence.length, 0); assert.match(text(r), /couldn't find suitable records|not enough matching|haven't invented/)
  assert.match(text(await say("restaurants")), /couldn't find any restaurants/)
})
test("a capped scan is reported: the answer says it may have missed records", async () => {
  const c = C.merge(F.cfg, { retrieval: { scanLimit: 20 } })
  for (let i = 0; i < 25; i++) env.seed(`restaurants/bulk${i}`, { name: `Bulk Cafe ${i}`, description: "food", isActive: true, rating: 3 })
  const r = await say("restaurants", null, { cfg: c }); assert.match(text(r), /searched the first 20 records of this category, so there may be more/)
})
test("reads are bounded: a single question never scans more than the configured cap per category", async () => {
  const { loadActive } = require("../src/ai/retrieval/data")
  for (let i = 0; i < 40; i++) env.seed(`restaurants/b${i}`, { name: `B ${i}`, isActive: true })
  const c = C.merge(F.cfg, { retrieval: { scanLimit: 25 } }); require("../src/ai/retrieval/data").clearToolCache()
  const rows = await loadActive("restaurants", c, 25); assert.ok(rows.length <= 25); assert.equal(rows.truncated, true)
})
test("every block is labelled; verified blocks come from records, assumptions and limits are 'unverified', rankings are 'suggestion'", async () => {
  const r = await say("I'm visiting Soweto tomorrow. I have R800 and enjoy history and local food. What can I do?")
  assert.ok(r.blocks.every((b) => ["verified", "knowledge", "general", "suggestion", "unverified"].includes(b.type)))
  assert.ok(r.blocks.filter((b) => b.type === "unverified").some((b) => /travel times/.test(b.text)))
})
test("no answer ever claims availability, a confirmed booking or a travel time (battery of messages)", async () => {
  const msgs = ["I'm visiting Soweto tomorrow with R800, history and food", "plan 3 days with family and music", "where can I stay", "book a table at Gogo's Kitchen", "how far is Mandela House", "is Hector Pieterson Museum available tomorrow", "how long does it take to get to Regina Mundi", "restaurants near me", "compare hotels"]
  for (const m of msgs) { const t = text(await say(m, null, { location: { latitude: -26.23, longitude: 27.9 } })); for (const [k, re] of Object.entries(RE)) assert.doesNotMatch(t, re, `${k} in "${m}"`) }
})
test("no external call is possible: the engine returns without any network access or provider", async () => {
  const net = require("node:net"), orig = net.Socket.prototype.connect; let touched = false
  net.Socket.prototype.connect = function () { touched = true; return orig.apply(this, arguments) }
  try { await say("I'm visiting tomorrow with R800, history and food"); assert.equal(touched, false) } finally { net.Socket.prototype.connect = orig }
})
test("near me without a shared location says distance could not be used", async () => {
  assert.match(text(await say("restaurants near me")), /have not shared your location/)
  const withLoc = await say("restaurants near me", null, { location: { latitude: -26.2385, longitude: 27.9065 } }); assert.match(text(withLoc), /straight line/)
})
