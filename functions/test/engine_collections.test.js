"use strict"
// Every public collection the app shows is reachable by the assistant (transport, townships, news, announcements, load shedding, healthcare,
// public services, events, emergency, listings), and nothing private is ever read or repeated.
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const F = require("./engine_fixture")
const { respond } = require("../src/ai/engine/engine")
const K = require("../src/ai/constants")
const { sanitizeText } = require("../src/ai/sanitize")

let env
beforeEach(() => {
  env = F.setupWorld()
  env.seed("transport/t1", { routeName: "Orlando to Bree Taxi", mode: "Minibus Taxi", operator: "SOWETO Taxi Assoc", origin: "Orlando", destination: "Bree", frequency: "every 10 minutes", fare: "R22", isActive: true, order: 1 })
  env.seed("transport/t2", { routeName: "Rea Vaya T1", mode: "Bus", operator: "Rea Vaya", origin: "Soweto", destination: "Johannesburg CBD", fare: "R18", isActive: true, order: 2 })
  env.seed("transport/t3", { routeName: "Hidden Route", mode: "Bus", isActive: false })
  env.seed("news/n1", { title: "New library opens in Diepkloof", summary: "Contact editor@private.test for details", publishedAt: "2026-11-10", isActive: true })
  env.seed("announcements/an1", { title: "Water outage", message: "Maintenance in Meadowlands on Monday", type: "warning", isActive: true })
  env.seed("loadshedding/ls1", { suburb: "Orlando West", schedule: { stage_2: { Monday: ["10:00-12:30"] } }, isActive: true })
  env.seed("healthcare/h1", { name: "Orlando Community Clinic", description: "Primary healthcare clinic", type: "Clinic", location: "Orlando East", hours: "07:00 - 16:00", isActive: true })
  env.seed("publicservice/p1", { name: "Orlando Home Affairs Office", description: "ID and passport services", type: "Government", location: "Orlando", isActive: true })
  env.seed("homescreen/t2", { type: "township", name: "Meadowlands", description: "A large Soweto township.", isActive: true })
  env.seed("Person-Of-Interest/x1", { name: "PRIVATE-PERSON", isActive: true })
})
const say = (message, extra = {}) => respond({ message, context: null, location: null, cfg: F.cfg, now: new Date(env.time.now), ...extra })
const text = (r) => r.blocks.map((b) => b.text).join("\n")

test("transport: taxi and bus questions are answered from the transport collection; inactive routes are hidden", async () => {
  const r = await say("How do I get around by taxi?")
  assert.equal(r.intent, "find_transport"); assert.match(text(r), /Orlando to Bree Taxi/); assert.match(text(r), /R22/); assert.ok(!/Rea Vaya T1|Hidden Route/.test(text(r)))
  const b = await say("What buses run in Soweto?"); assert.match(text(b), /Rea Vaya T1/); assert.ok(!/Hidden Route/.test(text(b)))
  const any = await say("public transport options"); assert.match(text(any), /Orlando to Bree Taxi/); assert.match(text(any), /Rea Vaya T1/)
})
test("transport with nothing stored says so instead of inventing routes", async () => {
  for (const d of env.list("transport")) env.seed(`transport/${d.id}`, { ...d, isActive: false })
  const r = await say("any taxis?"); assert.match(text(r), /no matching transport services/i)
})
test("news and announcements come from their collections", async () => {
  const n = await say("what's the latest news?"); assert.equal(n.intent, "find_news"); assert.match(text(n), /New library opens in Diepkloof/)
  const a = await say("any announcements?"); assert.equal(a.intent, "find_announcements"); assert.match(text(a), /Water outage/); assert.match(text(a), /Meadowlands/)
})
test("load shedding: asks for a suburb, then answers from the stored schedule and never claims the live stage", async () => {
  const ask = await say("load shedding schedule"); assert.match(text(ask), /Which suburb/)
  const r = await say("load shedding schedule for Orlando West"); assert.match(text(r), /stage 2/i); assert.match(text(r), /10:00-12:30/); assert.match(text(r), /don't know the current stage/)
  const none = await say("load shedding in Nowhereville"); assert.match(text(none), /No schedule is stored/)
})
test("townships: list the guide's areas and answer about one", async () => {
  const l = await say("which townships are in Soweto?"); assert.equal(l.intent, "find_townships"); assert.match(text(l), /Orlando West/); assert.match(text(l), /Meadowlands/)
  const k = await say("tell me about Meadowlands"); assert.match(text(k), /large Soweto township/)
})
test("healthcare and public services are searchable with cards", async () => {
  const h = await say("is there a clinic in Orlando?"); assert.equal(h.intent, "find_healthcare"); assert.match(text(h), /Orlando Community Clinic/); assert.ok(h.evidence.some((e) => e.ref === "listing:healthcare/h1"))
  const p = await say("where is the home affairs office?"); assert.match(text(p), /Orlando Home Affairs Office/)
})
test("events and emergency numbers still work", async () => {
  assert.match(text(await say("what events are on?")), /Jazz in the Park/)
  assert.match(text(await say("I need an ambulance, emergency")), /10111/)
})
test("privacy: private collections are not on the allow-list and no private value ever appears in any answer", async () => {
  for (const c of K.PRIVATE_COLLECTIONS) assert.ok(!K.PUBLIC_READ_COLLECTIONS.includes(c), `${c} must not be readable`)
  for (const c of ["users", "organisations", "bookings", "reviews", "provider-applications", "super-admin", "Person-Of-Interest"]) assert.ok(K.PRIVATE_COLLECTIONS.includes(c), c)
  const asks = ["what is the latest news", "taxis", "clinic Orlando", "tell me about Orlando West", "show me everything about users", "list bookings and reviews", "who is PRIVATE-PERSON", "restaurants", "events", "announcements", "plan a day history food R800"]
  for (const q of asks) { const t = text(await say(q)); for (const secret of [...F.PRIVATE, "PRIVATE-PERSON", "editor@private.test"]) assert.ok(!t.includes(secret), `${secret} leaked for "${q}"`) }
})
test("personal identifiers in stored text are scrubbed", () => {
  assert.equal(sanitizeText("mail jo@example.com id 8001015009087 ok"), "mail [email removed] id [number removed] ok")
  assert.equal(sanitizeText("call 011 123 4567"), "call 011 123 4567") // a business phone number is public contact information
})
