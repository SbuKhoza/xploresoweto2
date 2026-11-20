"use strict"
// Server-side usage control. All limits are enforced INSIDE Firestore transactions, so concurrent requests (several devices, a
// script calling the function in parallel) cannot slip past a limit: Firestore retries a transaction whose reads changed.
//   ai-usage/u_{uid}_{YYYY-MM-DD}  per-user, per-SAST-day counters, burst timestamps and in-flight requests
//   ai-usage/g_{YYYY-MM}           global monthly spend, reserved spend, thresholds notified and the circuit breaker
// Clients have no access to either document (rules deny everything); the user sees a summary through aiGetUsage.
const fb = require("../lib/firebase")
const clock = require("../lib/clock")
const { writeAudit } = require("../lib/audit")
const { AI_COL } = require("./constants")
const log = require("./log")

const day = () => clock.todaySAST()
const month = () => day().slice(0, 7)
const userId = (uid) => `u_${uid}_${day()}`
const globalId = () => `g_${month()}`
const col = () => fb.db().collection(AI_COL.usage)
const secondsToMidnightSAST = () => { // South Africa is UTC+2 all year
  const ms = (clock.now().getTime() + 2 * 3600000) % 86400000
  return Math.ceil((86400000 - ms) / 1000)
}
const newUser = (uid) => ({ uid, day: day(), requests: 0, completed: 0, failed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0, toolCalls: 0, recent: [], inflight: {} })
const newGlobal = () => ({ month: month(), spentMicros: 0, reservedMicros: 0, requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, thresholdsNotified: [], breakerTrippedAt: null, breakerReason: null, breakerOverride: null })
const expireAt = (days) => fb.Timestamp().fromMillis(clock.now().getTime() + days * 86400000)

// Returns { ok:true, remainingToday, dailyLimit } or { ok:false, reason, ...safe numbers }. Never throws for a normal denial.
async function reserve({ uid, requestId, estimateMicros, cfg }) {
  const uRef = col().doc(userId(uid)), gRef = col().doc(globalId())
  return fb.db().runTransaction(async (tx) => {
    const [uSnap, gSnap] = [await tx.get(uRef), await tx.get(gRef)]
    const now = clock.now().getTime()
    const u = uSnap.exists ? uSnap.data() : newUser(uid)
    const g = gSnap.exists ? gSnap.data() : newGlobal()
    const budget = cfg.budget.monthlyUsd * 1e6
    const FV = fb.FieldValue()

    // 1. release reservations leaked by crashed/timed-out requests
    const staleMs = cfg.budget.inflightStaleSeconds * 1000
    let freed = 0
    for (const [rid, f] of Object.entries(u.inflight || {})) if (now - f.at > staleMs) { freed += f.estimate || 0; delete u.inflight[rid] }
    g.reservedMicros = Math.max(0, (g.reservedMicros || 0) - freed)

    let denied = null
    let tripped = false
    if (u.inflight[requestId]) denied = { reason: "in_progress" } // same request already running (double tap / retry race)
    else if (g.breakerOverride === "tripped" || g.breakerTrippedAt) denied = { reason: "unavailable" }
    else if (g.spentMicros >= budget * cfg.budget.tripFraction) { denied = { reason: "unavailable" }; tripped = true }
    else if (g.spentMicros + g.reservedMicros + estimateMicros > budget * cfg.budget.tripFraction) denied = { reason: "unavailable" } // not latched: capacity may free up
    else if (u.requests >= cfg.limits.dailyMessages) denied = { reason: "daily", limit: cfg.limits.dailyMessages, resetsInSeconds: secondsToMidnightSAST() }
    else {
      const windowMs = cfg.limits.burstWindowSeconds * 1000
      const recent = (u.recent || []).filter((t) => now - t < windowMs)
      u.recent = recent
      if (recent.length >= cfg.limits.burstPerMinute) denied = { reason: "burst", retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) }
    }

    if (tripped) {
      g.breakerTrippedAt = now; g.breakerReason = "budget"
      writeAudit(tx, { action: "ai.circuit_breaker.trip", actorUid: "system", details: { reason: "budget", spentMicros: g.spentMicros } })
    }
    if (!denied) {
      u.requests += 1
      u.recent = [...(u.recent || []), now].slice(-cfg.limits.burstPerMinute)
      u.inflight[requestId] = { at: now, estimate: estimateMicros }
      g.reservedMicros += estimateMicros
      g.requests = (g.requests || 0) + 1
    }
    tx.set(uRef, { ...u, updatedAt: FV.serverTimestamp(), expireAt: expireAt(400) })
    tx.set(gRef, { ...g, updatedAt: FV.serverTimestamp() })
    return denied ? { ok: false, ...denied } : { ok: true, remainingToday: cfg.limits.dailyMessages - u.requests, dailyLimit: cfg.limits.dailyMessages }
  })
}

// Settles a reservation. costMicros/usage = what was ACTUALLY consumed (can be non-zero even when the request failed part-way).
async function settle({ uid, requestId, estimateMicros, costMicros = 0, usage, toolCalls = 0, outcome, refundDaily = false, cfg }) {
  const uRef = col().doc(userId(uid)), gRef = col().doc(globalId())
  const u0 = usage || { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  return fb.db().runTransaction(async (tx) => {
    const [uSnap, gSnap] = [await tx.get(uRef), await tx.get(gRef)]
    const u = uSnap.exists ? uSnap.data() : newUser(uid)
    const g = gSnap.exists ? gSnap.data() : newGlobal()
    const budget = cfg.budget.monthlyUsd * 1e6
    const had = !!(u.inflight && u.inflight[requestId])
    if (had) { delete u.inflight[requestId]; g.reservedMicros = Math.max(0, (g.reservedMicros || 0) - estimateMicros) }
    if (outcome === "ok") u.completed += 1; else { u.failed += 1; g.failed = (g.failed || 0) + 1 }
    if (refundDaily && had) u.requests = Math.max(0, u.requests - 1) // a provider outage must not eat the user's daily allowance
    for (const k of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) { u[k] += u0[k] || 0; if (k in g) g[k] += u0[k] || 0 }
    u.costMicros += costMicros; u.toolCalls += toolCalls
    g.spentMicros += costMicros
    const FV = fb.FieldValue()
    for (const f of [...cfg.budget.warnFractions].sort((a, b) => a - b)) {
      if (g.spentMicros >= budget * f && !g.thresholdsNotified.includes(f)) {
        g.thresholdsNotified.push(f)
        writeAudit(tx, { action: "ai.budget.threshold", actorUid: "system", details: { threshold: f, spentMicros: g.spentMicros } })
        log.warn("ai.budget.threshold", { threshold: f, spentMicros: g.spentMicros })
      }
    }
    if (g.spentMicros >= budget * cfg.budget.tripFraction && !g.breakerTrippedAt) {
      g.breakerTrippedAt = clock.now().getTime(); g.breakerReason = "budget"
      writeAudit(tx, { action: "ai.circuit_breaker.trip", actorUid: "system", details: { reason: "budget", spentMicros: g.spentMicros } })
      log.error("ai.circuit_breaker.trip", { spentMicros: g.spentMicros })
    }
    tx.set(uRef, { ...u, updatedAt: FV.serverTimestamp(), expireAt: expireAt(400) })
    tx.set(gRef, { ...g, updatedAt: FV.serverTimestamp() })
  })
}

async function getUsageStatus(uid, cfg) {
  const s = await col().doc(userId(uid)).get()
  const used = s.exists ? s.data().requests || 0 : 0
  return { dailyLimit: cfg.limits.dailyMessages, usedToday: used, remainingToday: Math.max(0, cfg.limits.dailyMessages - used), burstPerMinute: cfg.limits.burstPerMinute, resetsInSeconds: secondsToMidnightSAST() }
}
async function getGlobalSummary(cfg) {
  const s = await col().doc(globalId()).get()
  const g = s.exists ? s.data() : newGlobal()
  const budget = cfg.budget.monthlyUsd * 1e6
  return { month: g.month, budgetUsd: cfg.budget.monthlyUsd, spentUsd: g.spentMicros / 1e6, reservedUsd: g.reservedMicros / 1e6, fractionSpent: budget ? g.spentMicros / budget : 0, requests: g.requests || 0, failed: g.failed || 0, inputTokens: g.inputTokens || 0, outputTokens: g.outputTokens || 0, thresholdsNotified: g.thresholdsNotified || [], breakerTripped: !!(g.breakerTrippedAt || g.breakerOverride === "tripped"), breakerReason: g.breakerReason || (g.breakerOverride === "tripped" ? "manual" : null) }
}
// Super Admin controls (audited by the calling handler)
async function setBreaker({ action }) {
  const gRef = col().doc(globalId())
  return fb.db().runTransaction(async (tx) => {
    const s = await tx.get(gRef)
    const g = s.exists ? s.data() : newGlobal()
    const was = !!(g.breakerTrippedAt || g.breakerOverride === "tripped")
    if (action === "reset") { g.breakerTrippedAt = null; g.breakerReason = null; g.breakerOverride = null }
    else { g.breakerOverride = "tripped"; g.breakerReason = "manual" }
    tx.set(gRef, { ...g, updatedAt: fb.FieldValue().serverTimestamp() })
    return { was, now: action !== "reset" }
  })
}
module.exports = { reserve, settle, getUsageStatus, getGlobalSummary, setBreaker, secondsToMidnightSAST, userId, globalId }
