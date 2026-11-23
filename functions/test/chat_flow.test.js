"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const F = require("./engine_fixture")
const { req, anon, rejects, makeSuperAdmin } = require("./helpers")
const H = require("../src/handlers/ai")
const R = require("../src/ai/ratelimit")

let env, n = 0
beforeEach(() => { env = F.setupWorld() })
const ask = (uid = "u1", message = "Where can I eat kota in Orlando West?", extra = {}, opts) => H.aiChat(req(uid, { message, requestId: extra.requestId || `req-${++n}-${Math.random().toString(36).slice(2, 8)}`, ...extra }, opts))
const dump = (o) => JSON.stringify(o)

test("happy path: composed answer, cards from the database, stored, counted; response carries no model, token or cost fields", async () => {
  const r = await ask("u1")
  assert.equal(r.engine, "database-v1"); assert.equal(r.cards[0].title, "Gogo's Kitchen"); assert.equal(r.cards[0].priceText, "R80 - R150"); assert.match(r.conversationId, /^c_[a-f0-9]{24}$/)
  assert.deepEqual(r.usage, { dailyLimit: 50, remainingToday: 49 })
  assert.ok(!/model|token|cost|usd|anthropic|provider/i.test(Object.keys(r).join()))
  const msgs = env.list(`ai-conversations/${r.conversationId}/messages`); assert.equal(msgs.length, 2)
  const u = env.get(`ai-usage/${R.userId("u1")}`); assert.deepEqual([u.requests, u.completed, u.failed], [1, 1, 0]); assert.deepEqual(u.inflight, {})
  assert.equal(env.list("ai-usage").length, 1) // no global document
})
test("authentication: anonymous and unverified users are refused", async () => {
  await rejects(H.aiChat(anon({ message: "hi", requestId: "req-anon-1" })), "unauthenticated")
  await rejects(ask("u1", "hi", {}, { verified: false }), "failed-precondition", "email-not-verified")
})
test("invalid input is rejected before anything is read or counted", async () => {
  const bad = [{ message: "" }, { message: "   " }, { message: "x".repeat(1001) }, { message: "hi\u0000there" }, { message: 5 }, { message: "hi", extra: 1 }, { message: "hi", requestId: "!!" }, { message: "hi", conversationId: "../x" }, { message: "hi", location: { latitude: 99, longitude: 0 } }, { message: "hi", location: { latitude: 1, longitude: 1, accuracy: 3 } }, null, [], "str"]
  for (const d of bad) await rejects(H.aiChat(req("u1", d && typeof d === "object" && !Array.isArray(d) ? { requestId: `req-${++n}-abcdef`, ...d } : d)), "invalid-argument")
  assert.equal(env.list("ai-usage").length, 0); assert.equal(env.list("ai-conversations").length, 0)
})
test("the client cannot supply a collection, a filter or a user id: extra fields are rejected", async () => {
  for (const extra of [{ collection: "users" }, { uid: "u2" }, { filter: { isActive: false } }, { ownerUid: "u2" }, { cfg: {} }]) await rejects(ask("u1", "restaurants", extra), "invalid-argument")
})
test("RATE LIMITING: the burst and daily limits apply through the callable, with controlled errors", async () => {
  for (let i = 0; i < 5; i++) await ask("u1", "hi")
  await rejects(ask("u1", "hi"), "resource-exhausted", "rate-limited")
  env.time.now += 61000
  env.seed("ai-config/default", { limits: { dailyMessages: 6 } }); require("../src/ai/config").invalidateConfigCache()
  await ask("u1", "hi"); await rejects(ask("u1", "hi"), "resource-exhausted", "daily-limit")
  assert.ok((await ask("u2", "hi")).usage) // another user is unaffected
})
test("IDEMPOTENCY: a retry with the same requestId returns the stored answer without a second allowance or second messages", async () => {
  const a = await ask("u1", "restaurants", { requestId: "req-same-1" }), b = await ask("u1", "restaurants", { requestId: "req-same-1", conversationId: a.conversationId })
  assert.equal(b.duplicate, true); assert.equal(b.messageId, a.messageId); assert.equal(env.list(`ai-conversations/${a.conversationId}/messages`).length, 2)
  assert.equal(env.get(`ai-usage/${R.userId("u1")}`).requests, 1)
})
test("OWNERSHIP: another user cannot read, continue, list or delete a conversation; a foreign id looks like a missing one", async () => {
  const a = await ask("alice", "restaurants"), cid = a.conversationId
  await rejects(H.aiGetConversation(req("bob", { conversationId: cid })), "not-found")
  await rejects(ask("bob", "continue", { conversationId: cid }), "not-found"); await rejects(H.aiDeleteConversation(req("bob", { conversationId: cid })), "not-found")
  await rejects(H.aiGetConversation(req("bob", { conversationId: "c_" + "0".repeat(24) })), "not-found")
  assert.deepEqual((await H.aiListConversations(req("bob", {}))).conversations, []); assert.equal((await H.aiListConversations(req("alice", {}))).conversations.length, 1)
  assert.equal(env.list(`ai-conversations/${cid}/messages`).length, 2); assert.equal(env.get(`ai-usage/${R.userId("bob")}`)?.requests ?? 0, 0) // bob's failed attempts did not touch alice's data
})
test("a refused foreign conversation attempt does not use an allowance; stored follow-up context is owner-only", async () => {
  const a = await ask("alice", "find restaurants under R300")
  const c = env.get(`ai-conversations/${a.conversationId}`); assert.ok(c.context && c.context.lastRefs.length >= 1)
  await rejects(ask("bob", "how much is the first one?", { conversationId: a.conversationId }), "not-found")
})
test("FOLLOW-UP through the callable: 'the first one' resolves from the stored context of the same conversation", async () => {
  const a = await ask("u1", "find restaurants under R300")
  const b = await ask("u1", "how much is the first one?", { conversationId: a.conversationId })
  assert.match(b.blocks[0].text, /listed price|no price listed/); assert.equal(b.cards.length, 1)
  const c = await ask("u1", "how much is the first one?") // a NEW conversation has no context: it asks instead of guessing
  assert.match(c.blocks[0].text, /Which place do you mean/)
})
test("the R800 example works end to end through the callable, with real cards and no booking created", async () => {
  const r = await ask("u1", "I'm visiting Soweto tomorrow. I have R800 and enjoy history and local food. What can I do?")
  assert.ok(r.cards.length >= 2 && r.cards.every((c) => c.ref.startsWith("listing:"))); assert.ok(r.blocks.some((b) => /travel times/.test(b.text))); assert.equal(env.list("bookings").length, 1)
  assert.deepEqual(r.bookingOffers.every((o) => ["listing:restaurants/r1", "listing:accommodations/ac1"].includes(o.ref)), true)
})
test("reopening a conversation rebuilds cards from the CURRENT records: a listing suspended since then shows as unavailable", async () => {
  const a = await ask("u1", "Where can I eat kota in Orlando West?")
  env.seed("restaurants/r1", { ...env.get("restaurants/r1"), isActive: false })
  const g = await H.aiGetConversation(req("u1", { conversationId: a.conversationId }))
  assert.ok(g.messages.at(-1).cards.some((c) => c.unavailable)); assert.ok(!dump(g).includes("PRIVATE-ORG-PHONE"))
})
test("the kill switch (enabled:false) makes the assistant unavailable without touching usage", async () => {
  env.seed("ai-config/default", { enabled: false }); require("../src/ai/config").invalidateConfigCache()
  await rejects(ask("u1", "hi"), "unavailable", "ai-disabled"); assert.equal(env.list("ai-usage").length, 0)
})
test("an internal engine failure returns a controlled error and refunds the allowance", async () => {
  const E = require("../src/ai/engine/engine"), orig = E.respond; require.cache[require.resolve("../src/ai/engine/engine")].exports.respond = async () => { throw new Error("boom with secret detail") }
  delete require.cache[require.resolve("../src/ai/chat")]; delete require.cache[require.resolve("../src/handlers/ai")]
  try {
    const H2 = require("../src/handlers/ai")
    await assert.rejects(H2.aiChat(req("u1", { message: "hi there", requestId: "req-boom-1" })), (e) => e.code === "internal" && !/boom|secret/.test(e.message))
    const u = env.get(`ai-usage/${R.userId("u1")}`); assert.deepEqual([u.requests, u.failed], [0, 1]) // refunded
  } finally { require.cache[require.resolve("../src/ai/engine/engine")].exports.respond = orig; delete require.cache[require.resolve("../src/ai/chat")]; delete require.cache[require.resolve("../src/handlers/ai")] }
})
test("usage summary and admin config: no spend figures, and a provider/model key cannot be set", async () => {
  await ask("u1", "hi")
  const u = await H.aiGetUsage(req("u1", {})); assert.deepEqual([u.dailyLimit, u.usedToday, u.remainingToday], [50, 1, 49]); assert.ok(!/cost|usd|budget|token/i.test(Object.keys(u).join()))
  const sa = makeSuperAdmin(env, "root")
  const g = await H.aiAdminGetUsage(sa({})); const { luna: lunaInfo, ...nonLuna } = g.config
  assert.ok(!/budget|spent|model|token/i.test(JSON.stringify(nonLuna))); assert.equal(lunaInfo.enabled, false) // Luna block: numbers and states only (asserted in luna.test.js)
  await rejects(H.aiAdminGetUsage(req("u1", {})), "permission-denied")
  assert.deepEqual((await H.aiAdminUpdateConfig(sa({ patch: { limits: { dailyMessages: 20 } } }))).updated, ["limits"])
  for (const patch of [{ models: { routine: "x" } }, { provider: "x" }, { budget: { monthlyUsd: 1 } }, { pricing: {} }]) await rejects(H.aiAdminUpdateConfig(sa({ patch })), "invalid-argument", "uneditable-setting")
  await rejects(H.aiAdminUpdateConfig(sa({ patch: { limits: { dailyMessages: 99999 } } })), "invalid-argument", "invalid-config")
})
test("deleting my data removes conversations but keeps usage counters", async () => {
  await ask("u1", "restaurants"); await ask("u1", "attractions")
  const d = await H.aiDeleteAllMyAiData(req("u1", {})); assert.equal(d.conversations, 2)
  assert.equal(env.get(`ai-usage/${R.userId("u1")}`).requests, 2)
})
