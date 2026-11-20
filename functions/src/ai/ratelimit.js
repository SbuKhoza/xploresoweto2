"use strict"
// Per-user usage limits, enforced inside Firestore transactions (so parallel requests from several devices cannot slip past them).
// Purpose now: protect Firestore reads and function invocations (there is no paid model). No money, tokens, budget or global document.
//   ai-usage/u_{uid}_{YYYY-MM-DD}  { uid, day, requests, completed, failed, recent[], inflight{}, updatedAt, expireAt }
// Clients cannot read or write it (rules deny everything); users see a summary through aiGetUsage.
const fb = require("../lib/firebase")
const clock = require("../lib/clock")
const { AI_COL } = require("./constants")

const day = () => clock.todaySAST()
const userId = (uid) => `u_${uid}_${day()}`
const col = () => fb.db().collection(AI_COL.usage)
const secondsToMidnightSAST = () => { const ms = (clock.now().getTime() + 2 * 3600000) % 86400000; return Math.ceil((86400000 - ms) / 1000) } // UTC+2 all year
const newUser = (uid) => ({ uid, day: day(), requests: 0, completed: 0, failed: 0, recent: [], inflight: {} })
const expireAt = (days) => fb.Timestamp().fromMillis(clock.now().getTime() + days * 86400000)
const STALE_INFLIGHT_MS = 120000

// -> { ok:true, remainingToday, dailyLimit } | { ok:false, reason: "daily"|"burst"|"in_progress", ... }
async function reserve({ uid, requestId, cfg }) {
  const ref = col().doc(userId(uid))
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const now = clock.now().getTime()
    const u = snap.exists ? snap.data() : newUser(uid)
    u.inflight = u.inflight || {}
    for (const [rid, at] of Object.entries(u.inflight)) if (now - at > STALE_INFLIGHT_MS) delete u.inflight[rid] // crashed request
    let denied = null
    if (u.inflight[requestId]) denied = { reason: "in_progress" }
    else if (u.requests >= cfg.limits.dailyMessages) denied = { reason: "daily", limit: cfg.limits.dailyMessages, resetsInSeconds: secondsToMidnightSAST() }
    else {
      const windowMs = cfg.limits.burstWindowSeconds * 1000
      u.recent = (u.recent || []).filter((t) => now - t < windowMs)
      if (u.recent.length >= cfg.limits.burstPerMinute) denied = { reason: "burst", retryAfterSeconds: Math.max(1, Math.ceil((u.recent[0] + windowMs - now) / 1000)) }
    }
    if (!denied) { u.requests += 1; u.recent = [...(u.recent || []), now].slice(-cfg.limits.burstPerMinute); u.inflight[requestId] = now }
    tx.set(ref, { ...u, updatedAt: fb.FieldValue().serverTimestamp(), expireAt: expireAt(400) })
    return denied ? { ok: false, ...denied } : { ok: true, remainingToday: cfg.limits.dailyMessages - u.requests, dailyLimit: cfg.limits.dailyMessages }
  })
}
// refund: an internal failure must not use up the user's allowance.
async function settle({ uid, requestId, outcome, refund = false }) {
  const ref = col().doc(userId(uid))
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const u = snap.exists ? snap.data() : newUser(uid)
    const had = !!(u.inflight && u.inflight[requestId])
    if (had) delete u.inflight[requestId]
    if (outcome === "ok") u.completed += 1; else u.failed += 1
    if (refund && had) u.requests = Math.max(0, u.requests - 1)
    tx.set(ref, { ...u, updatedAt: fb.FieldValue().serverTimestamp(), expireAt: expireAt(400) })
  })
}
async function getUsageStatus(uid, cfg) {
  const s = await col().doc(userId(uid)).get()
  const used = s.exists ? s.data().requests || 0 : 0
  return { dailyLimit: cfg.limits.dailyMessages, usedToday: used, remainingToday: Math.max(0, cfg.limits.dailyMessages - used), burstPerMinute: cfg.limits.burstPerMinute, resetsInSeconds: secondsToMidnightSAST() }
}
module.exports = { reserve, settle, getUsageStatus, secondsToMidnightSAST, userId }
