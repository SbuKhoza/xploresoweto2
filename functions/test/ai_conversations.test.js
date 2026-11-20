"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setupAi } = require("./ai_helpers")
const C = require("../src/ai/config")
const conv = require("../src/ai/conversations")
const { rejects } = require("./helpers")

let env, cfg
beforeEach(() => { env = setupAi(); cfg = C.DEFAULTS })
const turn = (uid, cid, rid, text = "hello there", extra = {}) => conv.persistTurn({ uid, cid, requestId: rid, userText: text, cfg, assistant: { blocks: [{ type: "general", text: "hi", refs: [] }], cardRefs: [], followUps: [], engine: "database-v1", language: "en", ...extra } })

test("persistTurn creates the conversation and exactly two messages, with a title and a 90-day expiry", async () => {
  const cid = conv.deterministicConversationId("u1", "req-1")
  await turn("u1", cid, "req-1", "Where can I eat <b>pap</b> in Soweto?")
  const c = env.get(`ai-conversations/${cid}`), msgs = env.list(`ai-conversations/${cid}/messages`)
  assert.deepEqual([c.ownerUid, c.messageCount, c.title], ["u1", 2, "Where can I eat pap in Soweto?"]); assert.equal(msgs.length, 2)
  assert.equal(Math.round((c.expireAt.toMillis() - env.time.now) / 86400000), 90)
  assert.ok(msgs.every((m) => m.ownerUid === "u1" && m.expireAt)); assert.ok(msgs.find((m) => m.role === "user").createdAt.toMillis() < msgs.find((m) => m.role === "assistant").createdAt.toMillis())
})
test("retention is configurable", async () => {
  const c2 = C.merge(C.DEFAULTS, { retention: { days: 30 } }); const cid = "c_x"
  await conv.persistTurn({ uid: "u1", cid, requestId: "r1", userText: "hi", assistant: { blocks: [] }, cfg: c2 })
  assert.equal(Math.round((env.get(`ai-conversations/${cid}`).expireAt.toMillis() - env.time.now) / 86400000), 30)
})
test("persistTurn is idempotent: a retry or race never duplicates messages or counts", async () => {
  const cid = conv.deterministicConversationId("u1", "r1")
  const rs = await Promise.all([turn("u1", cid, "r1"), turn("u1", cid, "r1"), turn("u1", cid, "r1")])
  assert.equal(rs.filter((r) => !r.duplicate).length, 1); assert.equal(env.list(`ai-conversations/${cid}/messages`).length, 2); assert.equal(env.get(`ai-conversations/${cid}`).messageCount, 2)
})
test("ISOLATION: another user cannot continue, read, list, find a reply in, or delete someone else's conversation", async () => {
  const cid = conv.deterministicConversationId("alice", "r1"); await turn("alice", cid, "r1", "alice private question")
  await rejects(turn("bob", cid, "r2"), "not-found", "conversation-not-found")
  await rejects(conv.getConversation("bob", cid), "not-found"); await rejects(conv.findStoredReply("bob", cid, "r1"), "not-found"); await rejects(conv.deleteConversation("bob", cid), "not-found")
  assert.equal((await conv.listConversations("bob")).length, 0)
  assert.equal(env.list(`ai-conversations/${cid}/messages`).length, 2) // untouched
  await rejects(conv.getConversation("alice", "c_missing"), "not-found") // identical error for a missing conversation: no existence leak
})
test("follow-up context is stored on the owner's conversation, bounded, and never readable by another user", async () => {
  const cid = "c_ctx"; const context = { slots: { budget: { max: 800 } }, lastRefs: ["listing:restaurants/r1"], pending: null }
  await conv.persistTurn({ uid: "u1", cid, requestId: "r1", userText: "hi", assistant: { blocks: [] }, context, cfg })
  assert.deepEqual(await conv.loadContext("u1", cid), context)
  await rejects(conv.loadContext("bob", cid), "not-found")
  assert.equal(await conv.loadContext("u1", "c_missing"), null)
  await conv.persistTurn({ uid: "u1", cid, requestId: "r2", userText: "again", assistant: { blocks: [] }, cfg }) // no new context: the old one is kept
  assert.deepEqual(await conv.loadContext("u1", cid), context)
})
test("list returns only the caller's conversations, newest first", async () => {
  for (const [u, r] of [["u1", "a"], ["u1", "b"], ["u2", "c"]]) { env.time.now += 1000; await turn(u, conv.deterministicConversationId(u, r), r, `topic ${r}`) }
  const l = await conv.listConversations("u1"); assert.deepEqual(l.map((c) => c.title), ["topic b", "topic a"])
})
test("deleteConversation removes the conversation and ALL its messages immediately, and is idempotent", async () => {
  const cid = "c_d"; for (let i = 0; i < 3; i++) await turn("u1", cid, `r${i}`)
  assert.deepEqual(await conv.deleteConversation("u1", cid), { deleted: true }); assert.equal(env.get(`ai-conversations/${cid}`), undefined); assert.equal(env.list(`ai-conversations/${cid}/messages`).length, 0)
  assert.deepEqual(await conv.deleteConversation("u1", cid), { deleted: false })
})
test("deleteAllForUser removes only that user's AI data and KEEPS usage counters so it cannot be used to bypass limits", async () => {
  for (const [u, r] of [["u1", "a"], ["u1", "b"], ["u2", "c"]]) await turn(u, conv.deterministicConversationId(u, r), r)
  env.seed("ai-usage/u_u1_2026-11-14", { uid: "u1", requests: 7 })
  assert.deepEqual(await conv.deleteAllForUser("u1"), { conversations: 2 })
  assert.equal((await conv.listConversations("u1")).length, 0); assert.equal((await conv.listConversations("u2")).length, 1)
  assert.equal(env.get("ai-usage/u_u1_2026-11-14").requests, 7)
})
