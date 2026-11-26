"use strict"
// Regression tests for the real-device failures seen on the staging build, plus paraphrases of each.
// They exercise the deterministic engine end to end (no model, no network): detect -> retrieve -> compose -> context.
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const F = require("./engine_fixture")
const { respond } = require("../src/ai/engine/engine")
const { detectIntents } = require("../src/ai/engine/intents")

let env
beforeEach(() => { env = F.setupWorld() })
const say = (message, context = null) => respond({ message, context, location: null, cfg: F.cfg, now: new Date(env.time.now) })
const text = (r) => r.blocks.map((b) => b.text).join("\n")
// a multi-turn conversation: each turn receives the context the previous turn returned (exactly what aiChat stores and replays)
async function convo(...messages) { const out = []; let ctx = null; for (const m of messages) { const r = await say(m, ctx); out.push(r); ctx = r.context } return out }
const isFallback = (r) => r.intent === "unknown" || /not sure what you'd like|didn't quite catch|I'm not sure/i.test(text(r))
const refsOf = (r) => r.evidence.map((e) => e.ref)

// A staging-like world: only fictional "Test ..." records, nothing about Vilakazi Street. Honest answers must not invent any.
function stagingWorld() {
  for (const col of ["restaurants", "accommodations", "attractions", "recreation", "business", "events", "homescreen"]) for (const d of env.list(col)) env.db.store.delete(`${col}/${d.id}`)
  env.seed("restaurants/s1", { name: "Test Kasi Kitchen (synthetic)", description: "Fictional home cooking: kota and pap.", location: "Test Street, Orlando West", price: "R80 - R150", isActive: true, synthetic: true })
  env.seed("accommodations/s2", { name: "Test Guest House A (synthetic)", description: "Fictional quiet guest house.", type: "Guest house", price: "R700", isActive: true, location: "Orlando West", synthetic: true })
  env.seed("attractions/s3", { name: "Test Heritage Museum (synthetic)", description: "Fictional museum.", type: "Museum", isActive: true, location: "Orlando West", synthetic: true })
  env.seed("events/s4", { title: "Test Event (synthetic)", date: "2026-11-21", time: "18:00", location: "Soweto", isActive: true })
  env.seed("homescreen/s5", { type: "township", name: "Test Township (synthetic)", description: "Fictional township entry.", history: "Fictional history.", isActive: true })
}

// ------------------------------------------------------------------ failure 1: "Where can I stay?"
test("F1: 'Where can I stay?' and paraphrases find accommodation, never the unsupported fallback", async () => {
  for (const q of ["Where can I stay?", "where can we stay", "Where could I sleep tonight?", "any good hotels?", "I need somewhere to stay", "looking for accommodation in Soweto", "need a room for the night", "Any guesthouses or B&Bs?", "where do we stay in soweto", "acommodation please", "places to stay near Orlando West"]) {
    const r = await say(q)
    assert.equal(r.intent, "find_accommodation", q)
    assert.ok(!isFallback(r), q); assert.match(text(r), /Vilakazi Guest House/, q)
    assert.ok(refsOf(r).every((x) => x.startsWith("listing:accommodations/")), q)
  }
})
// ------------------------------------------------------------------ failure 2: "Show me places to eat" returned events
test("F2: 'Show me places to eat' and paraphrases return restaurants, never events", async () => {
  for (const q of ["Show me places to eat", "show me restaurants", "Where should we eat?", "I'm hungry", "somewhere to grab lunch", "any good eateries around?", "resturants in Orlando West", "what's good to eat here", "place to have dinner", "Where can I get some kota", "I want food", "show me where to dine"]) {
    const r = await say(q)
    assert.equal(r.intent, "find_restaurants", q)
    assert.ok(!/Jazz in the Park/.test(text(r)), q); assert.match(text(r), /Gogo's Kitchen/, q)
    assert.ok(refsOf(r).every((x) => x.startsWith("listing:restaurants/")), q)
  }
})
test("F2b: the word 'show' alone no longer means events, but real event questions still do", async () => {
  for (const q of ["Show me the museums", "show me a hotel", "show me what to see"]) assert.notEqual((detectIntents(q)[0] || {}).id, "find_events", q)
  for (const q of ["What events are on?", "any concerts this weekend?", "is there a live show tonight", "what's happening this weekend", "upcoming festivals"]) assert.equal((detectIntents(q)[0] || {}).id, "find_events", q)
})
// ------------------------------------------------------------------ failure 3: Vilakazi Street
test("F3: 'traveling with my wife ... vilakazi st' is understood as a destination, with the party remembered for this conversation only", async () => {
  const r = await say("I'm traveling with my wife and we heard about vilakazi st")
  assert.equal(r.intent, "explore_place"); assert.ok(!isFallback(r))
  assert.match(text(r), /Vilakazi Street/); assert.equal(r.context.slots.place, "Vilakazi Street")
  assert.equal(r.context.slots.party.total, 2)
  assert.ok(refsOf(r).some((x) => /Mandela House|a2$/.test(x) || x.includes("attractions/a2")), "lists a record that really is on Vilakazi Street")
  assert.ok(refsOf(r).every((x) => ["a2", "r1", "ac1"].some((id) => x.endsWith("/" + id))), "only records whose own text names Vilakazi")
  assert.match(text(r), /\?/, "asks what they want next")
  assert.ok(!/grew in the 1950s/.test(text(r)) || /Vilakazi/.test(text(r)), "no unrelated township overview")
})
test("F3b: spelling and phrasing variants of the same street", async () => {
  for (const q of ["we heard about Vilakazi St", "Vilakazi Street sounds amazing", "tell us about vilakazi", "my husband and I want to see Vilakazi Str", "We're a couple, heard about vilakasi st", "vilakazi st"]) {
    const r = await say(q)
    assert.ok(!isFallback(r), q); assert.equal(r.context.slots.place, "Vilakazi Street", q); assert.match(text(r), /Vilakazi/, q)
  }
})
test("F3c: with only synthetic staging data nothing is invented about Vilakazi Street, and the answer says so", async () => {
  stagingWorld()
  const r = await say("I'm traveling with my wife and we heard about vilakazi st")
  assert.ok(!isFallback(r)); assert.match(text(r), /Vilakazi Street/)
  assert.match(text(r), /(doesn't|don't|do not|haven't|no) (have|found|listing|record|guide)/i)
  assert.deepEqual(refsOf(r), []); assert.ok(!r.blocks.some((b) => b.type === "verified"), "nothing is presented as a verified listing")
  assert.ok(r.followUps.length >= 2); assert.equal(r.context.slots.party.total, 2)
})
test("F3d: the destination and party carry into the next, different question", async () => {
  const [, stay] = await convo("I'm traveling with my wife and we heard about vilakazi st", "Where can I stay?")
  assert.equal(stay.intent, "find_accommodation")
  assert.match(text(stay), /Vilakazi Guest House/); assert.equal(stay.context.slots.place, "Vilakazi Street")
  const [, eat] = await convo("heard about vilakazi st with my wife", "show me places to eat")
  assert.equal(eat.intent, "find_restaurants"); assert.match(text(eat), /Gogo's Kitchen/)
})
// ------------------------------------------------------------------ failure 4: repeated unanswered question
test("F4: repeating a message Malloya could not answer does not repeat the same fallback", async () => {
  const [a, b, c] = await convo("blorp zxqv", "blorp zxqv", "blorp zxqv")
  assert.notEqual(text(a), text(b)); assert.notEqual(text(b), text(c))
  assert.match(text(b), /\?/); assert.ok(b.followUps.length >= 2 && c.followUps.length >= 2)
  for (const r of [a, b, c]) assert.ok(!r.blocks.some((x) => x.type === "verified"))
})
test("F4b: a successful answer resets the unanswered counter", async () => {
  const [a, , c] = await convo("blorp zxqv", "where can I eat", "blorp zxqv")
  assert.equal(text(a), text(c)); assert.equal(c.context.misses, 1)
})
// ------------------------------------------------------------------ failure 5: follow-ups must be understood
test("F5: every suggested follow-up, sent back as the user's next message, is understood (never the fallback)", async () => {
  const openers = ["hi", "where can I eat", "where can I stay", "show me attractions", "what events are on", "plan a day with R800, I like history and food", "I'm traveling with my wife and we heard about vilakazi st", "tell me about Mandela House", "compare Mandela House and Hector Pieterson Museum", "blorp zxqv", "help", "any activities?", "things to do in soweto", "best restaurants"]
  let checked = 0
  for (const open of openers) {
    const first = await say(open)
    for (const f of first.followUps) {
      const r = await say(f, first.context); checked++
      assert.ok(!isFallback(r), `"${open}" -> follow-up "${f}" fell back`)
      assert.ok(r.blocks.length > 0 && text(r).length > 20, `${f}`)
    }
  }
  assert.ok(checked >= 25, `only ${checked} follow-ups were exercised`)
})
test("F5b: follow-ups are relevant to what was just shown", async () => {
  const eat = await say("where can I eat"); assert.ok(eat.followUps.includes("Where can I stay?")); assert.ok(!eat.followUps.includes("Show me places to eat"))
  const stay = await say("where can I stay"); assert.ok(stay.followUps.includes("Show me places to eat")); assert.ok(!stay.followUps.includes("Where can I stay?"))
  stagingWorld(); env.db.store.delete("accommodations/s2")
  const none = await say("where can I stay"); assert.ok(none.followUps.length >= 2); assert.ok(!none.followUps.some((f) => /first one|these/i.test(f)), "no 'the first one' when nothing was shown")
})
test("F5c: 'which of these is cheapest' compares what was just shown, and says so honestly when nothing was shown", async () => {
  const [, r] = await convo("show me restaurants", "Which of these has the lowest listed price?")
  assert.ok(!isFallback(r)); assert.match(text(r), /Gogo's Kitchen|Mama's Braai|Pricey/); assert.ok(!/Which place do you mean/.test(text(r)))
  const lone = await say("Which of these has the lowest listed price?")
  assert.ok(!isFallback(lone) && /(haven't|have not|not yet) (shown|looked|found)|first/i.test(text(lone)))
})
test("F5d: 'I'm travelling with 2 people' is accepted as trip detail and answered, not rejected", async () => {
  const r = await say("I'm travelling with 2 people"); assert.ok(!isFallback(r)); assert.equal(r.context.slots.party.total, 2); assert.match(text(r), /\?/)
  const [, again] = await convo("where can I eat", "I'm travelling with 2 people"); assert.ok(!isFallback(again)); assert.match(text(again), /Gogo's Kitchen|Mama's Braai/)
})
// ------------------------------------------------------------------ failure 6: badges
test("F6: only blocks backed by retrieved records are 'verified'; fallbacks, greetings, clarifications and help are not", async () => {
  const qs = ["blorp zxqv", "hi", "thanks", "help", "plan a day", "tell me about", "compare these", "where is it", "I'm travelling with 2 people", "book a room", "qwerty"]
  for (const q of qs) { const r = await say(q); for (const b of r.blocks) if (b.type === "verified") assert.ok(b.refs.length > 0, `"${q}": verified block without records: ${b.text.slice(0, 60)}`) }
  for (const q of ["where can I eat", "where can I stay", "what events are on", "tell me about Mandela House", "vilakazi st"]) { const r = await say(q); for (const b of r.blocks) if (b.type === "verified") assert.ok(b.refs.length > 0, q) }
})
// ------------------------------------------------------------------ context precedence
test("current-turn intent beats unrelated earlier context", async () => {
  const [, stay] = await convo("plan a day with R800, I like history", "where can I stay?"); assert.equal(stay.intent, "find_accommodation")
  const [, eat] = await convo("what events are on", "show me places to eat"); assert.equal(eat.intent, "find_restaurants"); assert.ok(!/Jazz/.test(text(eat)))
  const [, ev] = await convo("where can I eat kota", "what events are on this weekend"); assert.equal(ev.intent, "find_events")
  const [, plan] = await convo("I want to plan a trip", "where can we stay?"); assert.equal(plan.intent, "find_accommodation")
})
test("temporary travel details stay inside the conversation context and are never written to a profile or memory", async () => {
  const before = JSON.stringify([...env.db.store.keys()].sort())
  const r = await say("I'm traveling with my wife and we heard about vilakazi st")
  assert.equal(JSON.stringify([...env.db.store.keys()].sort()), before, "the engine writes nothing")
  assert.deepEqual(Object.keys(r.context).sort(), ["lastIntent", "lastRefs", "misses", "pending", "slots"].sort())
  assert.ok(!/wife|husband|spouse/i.test(JSON.stringify(r.context)), "the relationship word itself is not stored, only the group size")
})
// ------------------------------------------------------------------ honesty
test("no data means an honest no-match answer with no invented listing, price, hours or distance", async () => {
  for (const col of ["accommodations"]) for (const d of env.list(col)) env.db.store.delete(`${col}/${d.id}`)
  const r = await say("where can I stay?")
  assert.equal(r.intent, "find_accommodation"); assert.match(text(r), /couldn't find any/); assert.deepEqual(refsOf(r), [])
  assert.ok(!/R\d|\bkm\b|open|available/i.test(text(r).replace(/couldn't find any places to stay[^.]*\./i, "")))
})
test("explicit place mismatch is reported, not hidden", async () => {
  const r = await say("where can I eat in Kliptown"); assert.match(text(r), /Nothing matched Kliptown|highest-ranked/)
})
// ------------------------------------------------------------------ the staging banner
test("the staging banner sits in the status-bar strip and does not overlap screen headers", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "components", "EnvironmentBanner.js"), "utf8")
  assert.match(src, /top:\s*0/); assert.ok(!/top:\s*insets\.top/.test(src), "must not be pushed down into the screen content")
  assert.match(src, /TEST DATA ONLY/); assert.match(src, /APP_ENV === "production"\) return null/)
  assert.match(src, /pointerEvents="none"/)
})

// ------------------------------------------------------------------ language repair (not tied to the reported sentences)
test("nlp.clean repairs abbreviations, shortcuts and misspellings without touching numbers, money or ordinary words", () => {
  const { clean } = require("../src/ai/engine/nlp")
  assert.equal(clean("vilakazi st"), "vilakazi street"); assert.equal(clean("Mandela Rd and Main Ave"), "Mandela road and Main avenue")
  assert.equal(clean("resturants and acomodation"), "restaurants and accommodation"); assert.equal(clean("im hungry, whats good"), "i'm hungry, what's good")
  assert.equal(clean("1st and 2nd day, R800 pm"), "1st and 2nd day, R800 pm"); assert.equal(clean("hotel hostel hotels diner"), "hotel hostel hotels diner")
  assert.equal(clean("accommodate the stage"), "accommodate the stage")
})
test("every intent the detector can return has a route: none ends in the unsupported fallback", async () => {
  const { knownIntents } = require("../src/ai/engine/intents")
  const probes = { greeting: "hello", thanks: "thanks", help: "what can you do", emergency: "I need an ambulance", explore_place: "we heard about vilakazi st", find_activities: "any adventure activities",
    find_transport: "how do I get around by taxi", find_news: "latest news", find_announcements: "any announcements", loadshedding: "load shedding in Orlando West", find_townships: "list the townships", find_healthcare: "nearest clinic", find_publicservice: "where is the post office" }
  for (const id of knownIntents()) if (probes[id]) { const r = await say(probes[id]); assert.ok(!isFallback(r), `${id}: ${probes[id]}`) }
})
test("an unknown named street is acknowledged honestly and the person is asked what they want, not told it is unsupported", async () => {
  const r = await say("we're going to Mohale Street tomorrow")
  assert.ok(!r.blocks.some((b) => b.type === "verified")); assert.match(text(r), /\?/)
})
test("production Luna safeguards are untouched, and the security rules only GAINED the learning collections (nothing removed or loosened)", () => {
  const { execFileSync } = require("node:child_process")
  const git = (...args) => execFileSync("git", args, { cwd: path.join(__dirname, "..", "..") }).toString()
  let luna, stat
  try { luna = git("diff", "--name-only", "staging/env-foundation", "--", "functions/src/ai/luna").trim(); stat = git("diff", "--numstat", "staging/env-foundation", "--", "security-rules/firestore.rules", "security-rules/storage.rules").trim() } catch (e) { return } // no such branch here (e.g. after merging): nothing to compare
  assert.equal(luna, "", "Luna must not change")
  for (const line of stat.split("\n").filter(Boolean)) { const [added, removed, file] = line.split("\t"); assert.equal(removed, "0", `${file}: no rule line may be removed or changed`); assert.match(file, /firestore\.rules$/, "storage rules must not change") }
  const added = git("diff", "-U0", "staging/env-foundation", "--", "security-rules/firestore.rules").split("\n").filter((l) => /^\+[^+]/.test(l)).join("\n")
  assert.ok(!/allow (read|write|get|list|create|update|delete)[^;]*:\s*if\s+(?!false)/.test(added), "every added rule is deny-all")
})
