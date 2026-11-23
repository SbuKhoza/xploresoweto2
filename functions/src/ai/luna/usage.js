"use strict"
// Luna usage accounting. Everything here is numbers only (no text, no ids beyond the owner uid on the user's own counter).
//   ai-usage/luna_u_{uid}_{day}          per-user: attempts (provider calls started), successes (validated rewrites), token totals
//   ai-usage/luna_g_{day}_{0..7}         global token budget, SPREAD over 8 documents so no single document is a write hot spot
//   ai-usage/luna_r_{hash(uid,requestId)} durable per-request record: the "paid-call crash rule"
// THE RULE: begin() commits the request record in state "called" (budget reserved at the MAXIMUM possible cost, attempt counted) in ONE
// transaction BEFORE any network request is made. Any existing record for a requestId means: never call the provider again for it.
// A crash after that commit therefore costs at most one lost rewrite and one conservatively charged reservation, never a second paid call.
// Reserved tokens that are never settled (crash) stay counted for that day only: bounded, conservative, no in-flight map to grow.
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")
const { sha256hex } = require("../../lib/crypto")
const { AI_COL } = require("../constants")
const { GLOBAL_SHARDS, REQUEST_RECORD_TTL_DAYS, KINDS } = require("./constants")

const col = () => fb.db().collection(AI_COL.usage)
const userRef = (uid, day) => col().doc(`luna_u_${uid}_${day}`)
const shardRef = (day, i) => col().doc(`luna_g_${day}_${i}`)
const requestRef = (uid, requestId) => col().doc(`luna_r_${sha256hex(`${uid}:${requestId}`).slice(0, 32)}`)
const ttl = (days) => fb.Timestamp().fromMillis(clock.now().getTime() + days * 86400000)
const stamp = () => fb.FieldValue().serverTimestamp()
const newUser = (uid, day) => ({ uid, day, attempts: 0, successes: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 })
const newShard = (day, shard) => ({ day, shard, tokens: 0, calls: 0 })
const firstShard = (uid, requestId) => parseInt(sha256hex(`shard:${uid}:${requestId}`).slice(0, 8), 16) % GLOBAL_SHARDS

// -> { ok:true, day, shard, reserved } | { ok:false, reason }
// reserveTokens = calibrated input tokens for this payload + the maximum output tokens (the most this call can possibly cost).
async function begin({ uid, requestId, cfg, reserveTokens }) {
  const L = cfg.luna.limits, day = clock.todaySAST()
  const perShard = Math.floor(L.dailyGlobalTokens / GLOBAL_SHARDS)
  if (!Number.isInteger(reserveTokens) || reserveTokens <= 0 || reserveTokens > perShard) return { ok: false, reason: "budget-too-small" }
  const start = firstShard(uid, requestId)
  for (let k = 0; k < GLOBAL_SHARDS; k++) { // normally exactly one transaction; others only when a shard is nearly full
    const shard = (start + k) % GLOBAL_SHARDS
    const r = await fb.db().runTransaction(async (tx) => {
      const rs = await tx.get(requestRef(uid, requestId))
      const us = await tx.get(userRef(uid, day))
      const gs = await tx.get(shardRef(day, shard))
      if (rs.exists) return { ok: false, reason: "request-seen" }
      const u = us.exists ? { ...newUser(uid, day), ...us.data() } : newUser(uid, day)
      if (u.successes >= L.dailySuccessPerUser) return { ok: false, reason: "daily-allowance" }
      if (u.attempts >= L.dailyAttemptsPerUser) return { ok: false, reason: "daily-attempts" }
      const g = gs.exists ? { ...newShard(day, shard), ...gs.data() } : newShard(day, shard)
      if (g.tokens + reserveTokens > perShard) return { ok: false, reason: "global-budget", full: true }
      tx.set(requestRef(uid, requestId), { uid, day, shard, state: "called", reserved: reserveTokens, calledAt: stamp(), expireAt: ttl(REQUEST_RECORD_TTL_DAYS) })
      tx.set(userRef(uid, day), { ...u, attempts: u.attempts + 1, updatedAt: stamp(), expireAt: ttl(3) })
      tx.set(shardRef(day, shard), { ...g, tokens: g.tokens + reserveTokens, calls: g.calls + 1, updatedAt: stamp(), expireAt: ttl(3) })
      return { ok: true, day, shard, reserved: reserveTokens }
    })
    if (r.ok || !r.full) return r
  }
  return { ok: false, reason: "global-budget" }
}

const actualOf = (usage) => (usage ? usage.input + usage.output : null)
const addUsage = (u, usage) => ({ ...u, inputTokens: u.inputTokens + (usage ? usage.input : 0), outputTokens: u.outputTokens + (usage ? usage.output : 0), cachedTokens: u.cachedTokens + (usage ? usage.cached : 0), reasoningTokens: u.reasoningTokens + (usage ? usage.reasoning : 0) })

// Settlement for a SUCCESSFUL, validated rewrite. Returned as a pair of hooks so persistTurn can run it inside ITS transaction:
// the conversation turn and the Luna usage then commit together or not at all. read(tx) before any write; write(tx) after.
function prepareSuccess({ uid, requestId, ticket, usage }) {
  let snaps = null
  return {
    async read(tx) {
      snaps = { r: await tx.get(requestRef(uid, requestId)), u: await tx.get(userRef(uid, ticket.day)), g: await tx.get(shardRef(ticket.day, ticket.shard)) }
    },
    write(tx) {
      if (!snaps || !snaps.r.exists || snaps.r.data().state !== "called") return false // already settled elsewhere: never double count
      const u = snaps.u.exists ? { ...newUser(uid, ticket.day), ...snaps.u.data() } : newUser(uid, ticket.day)
      const g = snaps.g.exists ? { ...newShard(ticket.day, ticket.shard), ...snaps.g.data() } : newShard(ticket.day, ticket.shard)
      const actual = actualOf(usage)
      const charged = actual === null ? ticket.reserved : actual // usage missing: charge the reservation (conservative)
      tx.set(requestRef(uid, requestId), { ...snaps.r.data(), state: "settled", outcome: "ok", actual: charged, settledAt: stamp() })
      tx.set(userRef(uid, ticket.day), { ...addUsage(u, usage), successes: u.successes + 1, updatedAt: stamp(), expireAt: ttl(3) })
      tx.set(shardRef(ticket.day, ticket.shard), { ...g, tokens: Math.max(0, g.tokens - ticket.reserved + charged), updatedAt: stamp(), expireAt: ttl(3) })
      return true
    },
  }
}

// Settlement for a call that did NOT produce an accepted rewrite (provider failure, or output rejected by the validator).
// kind: a provider failure kind, or "rejected" for a valid-but-refused output. Actual usage is always accounted when the provider reported it.
async function settleFailure({ uid, requestId, ticket, kind, usage }) {
  const rule = KINDS[kind]
  return fb.db().runTransaction(async (tx) => {
    const rs = await tx.get(requestRef(uid, requestId))
    const us = await tx.get(userRef(uid, ticket.day))
    const gs = await tx.get(shardRef(ticket.day, ticket.shard))
    if (!rs.exists || rs.data().state !== "called") return false
    const u = us.exists ? { ...newUser(uid, ticket.day), ...us.data() } : newUser(uid, ticket.day)
    const g = gs.exists ? { ...newShard(ticket.day, ticket.shard), ...gs.data() } : newShard(ticket.day, ticket.shard)
    const actual = actualOf(usage)
    // usage known -> charge exactly that. Unknown + provider rejected before any work (429/401/400) -> release. Unknown + may have run -> keep charged.
    const charged = actual !== null ? actual : rule && rule.charge === false ? 0 : ticket.reserved
    tx.set(requestRef(uid, requestId), { ...rs.data(), state: "settled", outcome: kind, actual: charged, settledAt: stamp() })
    tx.set(userRef(uid, ticket.day), { ...addUsage(u, usage), updatedAt: stamp(), expireAt: ttl(3) })
    tx.set(shardRef(ticket.day, ticket.shard), { ...g, tokens: Math.max(0, g.tokens - ticket.reserved + charged), updatedAt: stamp(), expireAt: ttl(3) })
    return true
  })
}

async function userStatus(uid, cfg) {
  const day = clock.todaySAST()
  const s = await userRef(uid, day).get()
  const u = s.exists ? s.data() : { successes: 0, attempts: 0 }
  return { dailySuccessLimit: cfg.luna.limits.dailySuccessPerUser, remainingToday: Math.max(0, cfg.luna.limits.dailySuccessPerUser - (u.successes || 0)) }
}
async function globalToday() { // admin: sum of the shard documents (numbers only)
  const day = clock.todaySAST()
  let tokens = 0, calls = 0
  for (let i = 0; i < GLOBAL_SHARDS; i++) { const s = await shardRef(day, i).get(); if (s.exists) { tokens += s.data().tokens || 0; calls += s.data().calls || 0 } }
  return { day, tokens, calls }
}
module.exports = { begin, prepareSuccess, settleFailure, userStatus, globalToday, requestRef, userRef, shardRef, firstShard }
