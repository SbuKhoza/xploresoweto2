"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setupAi } = require("./ai_helpers")
const C = require("../src/ai/config")
const U = require("../src/ai/usage")
const { T0 } = require("./helpers")

let env, cfg
const withCfg = (patch = {}) => C.merge(C.DEFAULTS, patch)
const MIN = 60000
beforeEach(() => { env = setupAi(); cfg = withCfg() })
const reserve = (uid, rid, est = 1000, c = cfg) => U.reserve({ uid, requestId: rid, estimateMicros: est, cfg: c })
const done = (uid, rid, o = {}) => U.settle({ uid, requestId: rid, estimateMicros: 1000, costMicros: 500, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }, outcome: "ok", cfg, ...o })

test("daily limit: exactly 10 messages per user per day, then a controlled denial with the reset time", async () => {
  for (let i = 1; i <= 10; i++) { env.time.now += 2 * MIN; const r = await reserve("u1", `r${i}`); assert.equal(r.ok, true, `request ${i}`); assert.equal(r.remainingToday, 10 - i); await done("u1", `r${i}`) }
  env.time.now += 2 * MIN
  const r = await reserve("u1", "r11")
  assert.deepEqual([r.ok, r.reason, r.limit], [false, "daily", 10]); assert.ok(r.resetsInSeconds > 0 && r.resetsInSeconds <= 86400)
  assert.equal((await reserve("u2", "x1")).ok, true) // other users are unaffected
})
test("daily limit resets at the next SAST day", async () => {
  const c2 = withCfg({ limits: { dailyMessages: 1 } })
  assert.equal((await reserve("u1", "a", 1000, c2)).ok, true); await done("u1", "a")
  env.time.now += 2 * MIN; assert.equal((await reserve("u1", "b", 1000, c2)).reason, "daily")
  env.time.now += 24 * 3600000; assert.equal((await reserve("u1", "c", 1000, c2)).ok, true)
})
test("burst limit: 3 per minute, with a retry-after, then allowed again after the window", async () => {
  for (let i = 1; i <= 3; i++) { assert.equal((await reserve("u1", `b${i}`)).ok, true); await done("u1", `b${i}`) }
  const d = await reserve("u1", "b4")
  assert.deepEqual([d.ok, d.reason], [false, "burst"]); assert.ok(d.retryAfterSeconds >= 1 && d.retryAfterSeconds <= 60)
  env.time.now += 61000; assert.equal((await reserve("u1", "b5")).ok, true)
})
test("RACE: 10 parallel requests from one user pass at most the burst limit (3)", async () => {
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve("racer", `p${i}`)))
  assert.equal(res.filter((r) => r.ok).length, 3); assert.equal(res.filter((r) => r.reason === "burst").length, 7)
})
test("RACE: parallel requests can never exceed the daily limit even when the burst limit is loose", async () => {
  const c2 = withCfg({ limits: { dailyMessages: 4, burstPerMinute: 60 } })
  const res = await Promise.all(Array.from({ length: 12 }, (_, i) => reserve("racer", `d${i}`, 1000, c2)))
  assert.equal(res.filter((r) => r.ok).length, 4)
})
test("RACE: the same requestId sent twice at once is admitted once (no double provider call)", async () => {
  const res = await Promise.all([reserve("u1", "same"), reserve("u1", "same"), reserve("u1", "same")])
  assert.equal(res.filter((r) => r.ok).length, 1); assert.equal(res.filter((r) => r.reason === "in_progress").length, 2)
})
test("a provider failure refunds the daily allowance but NOT the burst slot (no rapid-fire retries)", async () => {
  const c2 = withCfg({ limits: { dailyMessages: 2, burstPerMinute: 2 } })
  await reserve("u1", "a", 1000, c2); await U.settle({ uid: "u1", requestId: "a", estimateMicros: 1000, outcome: "failed", refundDaily: true, cfg: c2 })
  assert.equal((await U.getUsageStatus("u1", c2)).usedToday, 0)
  await reserve("u1", "b", 1000, c2); await U.settle({ uid: "u1", requestId: "b", estimateMicros: 1000, outcome: "failed", refundDaily: true, cfg: c2 })
  assert.equal((await reserve("u1", "c", 1000, c2)).reason, "burst") // two slots were used within the minute
})
test("settle: adds actual tokens/cost, clears the in-flight entry and releases the reserved amount", async () => {
  await reserve("u1", "a", 5000); await done("u1", "a", { estimateMicros: 5000, costMicros: 777 })
  const u = env.get(`ai-usage/${U.userId("u1")}`), g = env.get(`ai-usage/${U.globalId()}`)
  assert.deepEqual([u.completed, u.inputTokens, u.outputTokens, u.costMicros, Object.keys(u.inflight).length], [1, 100, 50, 777, 0])
  assert.deepEqual([g.spentMicros, g.reservedMicros, g.requests], [777, 0, 1])
  await done("u1", "a", { estimateMicros: 5000, costMicros: 0 }) // a duplicate settle must not release reserved budget twice
  assert.equal(env.get(`ai-usage/${U.globalId()}`).reservedMicros, 0)
})
test("budget alerts: 50% and 80% are each notified exactly once (audit log + log)", async () => {
  const c2 = withCfg({ budget: { monthlyUsd: 1 } })
  for (const [i, cost] of [[1, 400000], [2, 150000], [3, 300000], [4, 10000]]) { env.time.now += 2 * MIN; await reserve("u1", `a${i}`, 1000, c2); await done("u1", `a${i}`, { costMicros: cost, cfg: c2 }) }
  const a = env.list("audit-log").filter((x) => x.action === "ai.budget.threshold")
  assert.deepEqual(a.map((x) => x.details.threshold).sort(), [0.5, 0.8]); assert.equal(env.logs.filter((l) => l.event === "ai.budget.threshold").length, 2)
})
test("CIRCUIT BREAKER: reaching the monthly budget trips it once, blocks everyone, and persists until a Super Admin resets it", async () => {
  const c2 = withCfg({ budget: { monthlyUsd: 1 } })
  await reserve("u1", "a", 1000, c2); await done("u1", "a", { costMicros: 1000000, cfg: c2 })
  assert.equal(env.list("audit-log").filter((x) => x.action === "ai.circuit_breaker.trip").length, 1)
  for (const uid of ["u1", "u2", "u3"]) { env.time.now += 2 * MIN; assert.deepEqual([(await reserve(uid, "z", 1000, c2)).ok, (await reserve(uid, "z2", 1000, c2)).reason], [false, "unavailable"]) }
  const bigger = withCfg({ budget: { monthlyUsd: 100 } })
  assert.equal((await reserve("u9", "q", 1000, bigger)).reason, "unavailable") // still latched even though the budget grew
  assert.deepEqual(await U.setBreaker({ action: "reset" }), { was: true, now: false })
  assert.equal((await reserve("u9", "q2", 1000, bigger)).ok, true)
})
test("CIRCUIT BREAKER: a manual kill switch blocks all requests until reset", async () => {
  await U.setBreaker({ action: "trip" }); assert.equal((await reserve("u1", "a")).reason, "unavailable")
  await U.setBreaker({ action: "reset" }); assert.equal((await reserve("u1", "b")).ok, true)
})
test("RACE: the budget is protected by RESERVATION, so parallel requests cannot all pass and overspend", async () => {
  const c2 = withCfg({ budget: { monthlyUsd: 1 }, limits: { burstPerMinute: 60, dailyMessages: 100 } })
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => reserve(`user${i}`, `r${i}`, 400000, c2))) // $0.40 each against a $1 budget
  assert.equal(res.filter((r) => r.ok).length, 2)
  assert.equal(env.get(`ai-usage/${U.globalId()}`).reservedMicros, 800000)
})
test("stale in-flight reservations (crashed requests) are released so they cannot lock the budget forever", async () => {
  await reserve("u1", "crash", 900000); assert.equal(env.get(`ai-usage/${U.globalId()}`).reservedMicros, 900000)
  env.time.now += 10 * MIN; await reserve("u1", "next", 1000)
  assert.equal(env.get(`ai-usage/${U.globalId()}`).reservedMicros, 1000)
})
test("a new month starts a fresh budget and breaker", async () => {
  const c2 = withCfg({ budget: { monthlyUsd: 1 } })
  await reserve("u1", "a", 1000, c2); await done("u1", "a", { costMicros: 1000000, cfg: c2 })
  env.time.now = Date.UTC(2026, 11, 2, 10); assert.equal((await reserve("u1", "b", 1000, c2)).ok, true)
})
test("limits are configurable: a stored override changes the daily allowance immediately", async () => {
  const c2 = withCfg({ limits: { dailyMessages: 2, burstPerMinute: 60 } })
  assert.equal((await reserve("u1", "a", 1000, c2)).ok, true); assert.equal((await reserve("u1", "b", 1000, c2)).ok, true); assert.equal((await reserve("u1", "c", 1000, c2)).reason, "daily")
})
test("usage summaries expose numbers only (no content) and report remaining allowance", async () => {
  await reserve("u1", "a"); const s = await U.getUsageStatus("u1", cfg)
  assert.deepEqual([s.dailyLimit, s.usedToday, s.remainingToday, s.burstPerMinute], [10, 1, 9, 3]); assert.deepEqual(Object.keys(s).sort(), ["burstPerMinute", "dailyLimit", "remainingToday", "resetsInSeconds", "usedToday"])
  const g = await U.getGlobalSummary(cfg); assert.deepEqual([g.budgetUsd, g.breakerTripped], [50, false])
})
