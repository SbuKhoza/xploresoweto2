"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setupAi } = require("./ai_helpers")
const C = require("../src/ai/config")
const R = require("../src/ai/ratelimit")

let env, cfg
const MIN = 60000
const withCfg = (patch = {}) => C.merge(C.DEFAULTS, patch)
beforeEach(() => { env = setupAi(); cfg = withCfg() })
const reserve = (uid, rid, c = cfg) => R.reserve({ uid, requestId: rid, cfg: c })
const done = (uid, rid, o = {}) => R.settle({ uid, requestId: rid, outcome: "ok", ...o })

test("daily limit: exactly the configured messages per user per day, then a controlled denial with the reset time", async () => {
  const c = withCfg({ limits: { dailyMessages: 4 } })
  for (let i = 1; i <= 4; i++) { env.time.now += 2 * MIN; const r = await reserve("u1", `r${i}`, c); assert.equal(r.ok, true, `request ${i}`); assert.equal(r.remainingToday, 4 - i); await done("u1", `r${i}`) }
  env.time.now += 2 * MIN
  const r = await reserve("u1", "r5", c)
  assert.deepEqual([r.ok, r.reason, r.limit], [false, "daily", 4]); assert.ok(r.resetsInSeconds > 0 && r.resetsInSeconds <= 86400)
  assert.equal((await reserve("u2", "x1", c)).ok, true) // other users are unaffected
})
test("daily limit resets at the next SAST day", async () => {
  const c = withCfg({ limits: { dailyMessages: 1 } })
  assert.equal((await reserve("u1", "a", c)).ok, true); await done("u1", "a")
  env.time.now += 2 * MIN; assert.equal((await reserve("u1", "b", c)).reason, "daily")
  env.time.now += 24 * 3600000; assert.equal((await reserve("u1", "c", c)).ok, true)
})
test("burst limit: per-minute cap with a retry-after, then allowed again after the window", async () => {
  const c = withCfg({ limits: { burstPerMinute: 3 } })
  for (let i = 1; i <= 3; i++) { assert.equal((await reserve("u1", `b${i}`, c)).ok, true); await done("u1", `b${i}`) }
  const d = await reserve("u1", "b4", c); assert.deepEqual([d.ok, d.reason], [false, "burst"]); assert.ok(d.retryAfterSeconds >= 1 && d.retryAfterSeconds <= 60)
  env.time.now += 61000; assert.equal((await reserve("u1", "b4", c)).ok, true)
})
test("parallel requests cannot bypass the limits (transactional)", async () => {
  const c = withCfg({ limits: { dailyMessages: 3, burstPerMinute: 60 } })
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve("u1", `p${i}`, c)))
  assert.equal(rs.filter((r) => r.ok).length, 3)
})
test("the same request id while in flight is refused (double tap), and a stale in-flight entry from a crash is released", async () => {
  assert.equal((await reserve("u1", "dup")).ok, true)
  assert.equal((await reserve("u1", "dup")).reason, "in_progress")
  env.time.now += 3 * MIN; assert.equal((await reserve("u1", "dup")).ok, true)
})
test("an internal failure refunds the daily allowance, a normal completion does not", async () => {
  await reserve("u1", "f1"); await done("u1", "f1", { outcome: "failed", refund: true })
  assert.equal((await R.getUsageStatus("u1", cfg)).usedToday, 0)
  await reserve("u1", "ok1"); await done("u1", "ok1")
  assert.equal((await R.getUsageStatus("u1", cfg)).usedToday, 1)
})
test("usage documents hold counters only: no tokens, money, budget or global document exists", async () => {
  await reserve("u1", "a"); await done("u1", "a")
  const docs = env.list("ai-usage"); assert.equal(docs.length, 1)
  assert.ok(Object.keys(docs[0]).every((k) => ["id", "uid", "day", "requests", "completed", "failed", "recent", "inflight", "updatedAt", "expireAt"].includes(k)), Object.keys(docs[0]).join())
})
