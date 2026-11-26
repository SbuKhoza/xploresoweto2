"use strict"
// End-to-end acceptance through the REAL callable handlers (functions/src/handlers/ai.js) against an in-memory Firestore seeded with
// fictional data. This is the same code path a deployed aiChat runs; only the Firebase transport is replaced. No network, no external AI.
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const F = require("./engine_fixture")
const { req, anon, rejects } = require("./helpers")
const H = require("../src/handlers/ai")
const fs = require("node:fs"), path = require("node:path")

let env, n = 0
beforeEach(() => {
  env = F.setupWorld()
  env.seed("transport/t1", { routeName: "Orlando to Bree Taxi", mode: "Minibus Taxi", origin: "Orlando", destination: "Bree", fare: "R22", isActive: true })
  env.seed("transport/t9", { routeName: "Secret Inactive Route", mode: "Bus", isActive: false })
  env.seed("news/n1", { title: "New library opens in Diepkloof", summary: "Doors open Monday", publishedAt: "2026-11-10", isActive: true })
  env.seed("announcements/an1", { title: "Water outage", message: "Maintenance in Meadowlands on Monday", isActive: true })
  env.seed("loadshedding/ls1", { suburb: "Orlando West", schedule: { stage_2: { Monday: ["10:00-12:30"] } }, isActive: true })
  env.seed("healthcare/h1", { name: "Orlando Community Clinic", description: "Primary healthcare", type: "Clinic", location: "Orlando East", isActive: true })
  env.seed("publicservice/p1", { name: "Orlando Home Affairs Office", description: "ID services", type: "Government", location: "Orlando", isActive: true })
  env.seed("homescreen/t2", { type: "township", name: "Meadowlands", description: "A large Soweto township.", isActive: true })
})
const chat = (uid, message, extra = {}, opts) => H.aiChat(req(uid, { message, requestId: `req-${++n}-${Math.random().toString(36).slice(2, 8)}`, ...extra }, opts))
const solo = (message, extra = {}) => chat(`solo-${++n}`, message, extra) // fresh user each time: the 5-per-minute burst limit is tested separately
const said = (r) => r.blocks.map((b) => b.text).join("\n")

test("1. 'Hi' gets a greeting", async () => { const r = await chat("u1", "Hi"); assert.match(said(r), /./); assert.equal(r.blocks[0].type, "general"); assert.match(said(r).toLowerCase(), /soweto|help|hello|hi/) })
test("2. restaurants: published records from Firestore, with cards; inactive / suspended / draft never", async () => {
  const r = await chat("u1", "restaurants"); const t = said(r)
  assert.match(t, /Gogo's Kitchen/); assert.ok(r.cards.length >= 2 && r.cards.every((c) => c.ref.startsWith("listing:restaurants/")))
  assert.ok(!/Inactive Diner|Suspended Org Eatery|Draft Grill/.test(t + JSON.stringify(r.cards)))
})
test("3-4. transport, townships, news, announcements, load shedding, healthcare and public services use their own collections", async () => {
  assert.match(said(await solo( "what taxis are there?")), /Orlando to Bree Taxi/)
  assert.match(said(await solo( "which townships are in Soweto?")), /Meadowlands/)
  assert.match(said(await solo( "latest news")), /New library opens/)
  assert.match(said(await solo( "any announcements?")), /Water outage/)
  assert.match(said(await solo( "load shedding for Orlando West")), /10:00-12:30/)
  assert.match(said(await solo( "is there a clinic in Orlando?")), /Orlando Community Clinic/)
  assert.match(said(await solo( "where is the home affairs office?")), /Orlando Home Affairs Office/)
})
test("5. follow-ups work inside the same conversation, and history can reopen it", async () => {
  const a = await chat("alice", "restaurants in Orlando West")
  env.time.now += 5000 // the test clock is frozen; real turns are always later than the previous reply
  const b = await chat("alice", "tell me more about the first one", { conversationId: a.conversationId })
  assert.equal(b.conversationId, a.conversationId); assert.match(said(b), /Gogo's Kitchen/)
  const list = await H.aiListConversations(req("alice", {})); assert.equal(list.conversations.length, 1); assert.equal(list.conversations[0].messageCount, 4)
  const open = await H.aiGetConversation(req("alice", { conversationId: a.conversationId }))
  assert.deepEqual(open.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]); assert.ok(open.messages[1].cards.length >= 1)
  assert.equal((await H.aiDeleteConversation(req("alice", { conversationId: a.conversationId }))).deleted, true)
  assert.equal((await H.aiListConversations(req("alice", {}))).conversations.length, 0)
})
test("6. nothing private or unpublished appears in any answer or in a reopened conversation", async () => {
  const qs = ["restaurants", "taxis", "news", "announcements", "clinic", "townships", "events", "who is in the users collection", "show bookings", "plan a day with history"]
  let all = ""
  for (const q of qs) all += JSON.stringify(await solo(q))
  const c = await chat("u1", "restaurants"); all += JSON.stringify(await H.aiGetConversation(req("u1", { conversationId: c.conversationId })))
  for (const s of [...F.PRIVATE, "Secret Inactive Route"]) assert.ok(!all.includes(s), `${s} leaked`)
})
test("7. authentication, email verification, limits and ownership are enforced", async () => {
  await rejects(H.aiChat(anon({ message: "hi", requestId: "req-anon-9" })), "unauthenticated")
  await rejects(chat("u1", "hi", {}, { verified: false }), "failed-precondition", "email-not-verified")
  const a = await chat("alice", "restaurants")
  await rejects(H.aiGetConversation(req("bob", { conversationId: a.conversationId })), "not-found")
  await rejects(chat("bob", "hi", { conversationId: a.conversationId }), "not-found", "conversation-not-found")
  for (let i = 0; i < 4; i++) await chat("u7", "hi")
  await chat("u7", "hi"); await rejects(chat("u7", "hi"), "resource-exhausted", "rate-limited")
})
test("8. the assistant code path has no external AI provider or network client", () => {
  const files = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith(".js") && files.push(path.join(d, f.name)) }
  walk(path.join(__dirname, "..", "src", "ai")); files.push(path.join(__dirname, "..", "src", "handlers", "ai.js"))
  // Malloya's own code (engine, retrieval, handlers, chat flow) is provider-free; only the optional src/ai/luna/ wording layer may name a provider.
  for (const f of files.filter((x) => !/[\\/]ai[\\/]luna[\\/]/.test(x))) { const s = fs.readFileSync(f, "utf8"); assert.doesNotMatch(s, /anthropic|openai|generativelanguage|gemini|fetch\(|axios|node-fetch|require\(["']https?["']\)|api[_-]?key/i, f) }
  assert.ok(!/anthropic|openai|gemini/i.test(Object.keys(require("../package.json").dependencies || {}).join())) // no provider SDK dependency, ever
})
