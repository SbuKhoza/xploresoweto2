"use strict"
// Provider-level circuit breaker, shared by every instance through ONE Firestore document (ai-usage/luna-breaker).
//   closed    -> normal operation (the hot path only READS this document; it is written on failures and state changes only)
//   open      -> cooldown after repeated transient failures or a rate limit; Luna is not called
//   half_open -> cooldown over: exactly ONE probe in the whole system holds a lease (an expiring lease, so a crashed probe cannot deadlock it)
//   recovery  -> probe succeeded: a limited number of concurrent calls (globally, tracked here) for a short window, then closed
//   blocked   -> billing/quota or bad-key problem: no automatic retries; stays blocked until an operator bumps luna.resetEpoch
// If this document cannot be read, Luna is treated as OFF and Malloya answers deterministically.
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")
const { AI_COL } = require("../constants")
const { KINDS } = require("./constants")

const ref = () => fb.db().collection(AI_COL.usage).doc("luna-breaker")
const closed = (epoch = 0) => ({ state: "closed", failures: [], cooldownSeconds: 0, cooldownUntil: 0, lease: null, recoveryUntil: 0, inflight: {}, blockedKind: null, resetEpoch: epoch })
const stamp = () => ({ updatedAt: fb.FieldValue().serverTimestamp() })
const MAX_COOLDOWN = 600

async function peek() { // -> breaker data | null when unreadable
  try { const s = await ref().get(); return s.exists ? { ...closed(), ...s.data() } : closed() } catch (e) { return null }
}

// -> { allowed, mode: "normal"|"probe"|"recovery", reason? }
async function admit({ owner, cfg }) {
  const B = cfg.luna.breaker, epoch = cfg.luna.resetEpoch || 0
  const first = await peek()
  if (!first) return { allowed: false, reason: "breaker-unreadable" }
  if (first.state === "closed") return { allowed: true, mode: "normal" }
  try {
    return await fb.db().runTransaction(async (tx) => {
      const s = await tx.get(ref())
      const b = s.exists ? { ...closed(), ...s.data() } : closed()
      const now = clock.now().getTime()
      if (b.state === "blocked") {
        if (epoch > (b.resetEpoch || 0)) { tx.set(ref(), { ...closed(epoch), ...stamp() }); return { allowed: true, mode: "normal" } }
        return { allowed: false, reason: "blocked" }
      }
      if (b.state === "closed") return { allowed: true, mode: "normal" }
      if (b.state === "open") {
        if (now < b.cooldownUntil) return { allowed: false, reason: "open" }
        tx.set(ref(), { ...b, state: "half_open", lease: { owner, expiresAt: now + B.leaseSeconds * 1000 }, ...stamp() })
        return { allowed: true, mode: "probe" }
      }
      if (b.state === "half_open") {
        if (b.lease && b.lease.expiresAt > now) return { allowed: false, reason: "probe-in-progress" }
        tx.set(ref(), { ...b, lease: { owner, expiresAt: now + B.leaseSeconds * 1000 }, ...stamp() })
        return { allowed: true, mode: "probe" }
      }
      if (b.state === "recovery") {
        if (now >= b.recoveryUntil) { tx.set(ref(), { ...closed(b.resetEpoch || 0), ...stamp() }); return { allowed: true, mode: "normal" } }
        const live = Object.fromEntries(Object.entries(b.inflight || {}).filter(([, exp]) => exp > now))
        if (Object.keys(live).length >= cfg.luna.limits.recoveryConcurrent) return { allowed: false, reason: "recovery-capacity" }
        live[owner] = now + B.leaseSeconds * 1000
        tx.set(ref(), { ...b, inflight: live, ...stamp() })
        return { allowed: true, mode: "recovery" }
      }
      return { allowed: false, reason: "unknown-state" }
    })
  } catch (e) { return { allowed: false, reason: "breaker-unreadable" } }
}

// Record the outcome of an admitted call. `ok` means the PROVIDER behaved (an output our validator rejects is still a healthy provider).
async function report({ owner, mode, ok, kind, retryAfterSeconds, cfg }) {
  if (mode === "normal" && ok) return
  const B = cfg.luna.breaker, epoch = cfg.luna.resetEpoch || 0
  try {
    await fb.db().runTransaction(async (tx) => {
      const s = await tx.get(ref())
      const b = s.exists ? { ...closed(), ...s.data() } : closed()
      const now = clock.now().getTime()
      const rule = ok ? null : (KINDS[kind] || KINDS.server).breaker
      const open = (secs) => ({ ...b, state: "open", failures: [], lease: null, inflight: {}, cooldownSeconds: secs, cooldownUntil: now + secs * 1000 })
      const block = () => ({ ...closed(b.resetEpoch || epoch), state: "blocked", blockedKind: kind, resetEpoch: Math.max(b.resetEpoch || 0, epoch) })
      let next = null
      if (mode === "probe") {
        if (ok) next = { ...closed(b.resetEpoch || 0), state: "recovery", recoveryUntil: now + B.recoverySeconds * 1000 }
        else if (rule === "blocked") next = block()
        else next = open(Math.min(MAX_COOLDOWN, Math.max(B.cooldownSeconds, (b.cooldownSeconds || B.cooldownSeconds) * 2, retryAfterSeconds || 0)))
      } else if (mode === "recovery") {
        const inflight = { ...(b.inflight || {}) }; delete inflight[owner]
        if (ok) next = b.state === "recovery" ? { ...b, inflight } : null
        else if (rule === "blocked") next = block()
        else next = open(Math.max(B.cooldownSeconds, retryAfterSeconds || 0))
      } else if (b.state === "closed") { // normal-mode failure
        if (rule === "blocked") next = block()
        else if (rule === "open") next = open(Math.min(MAX_COOLDOWN, Math.max(B.cooldownSeconds, retryAfterSeconds || 0)))
        else { // counted failure inside a sliding window
          const failures = [...(b.failures || []).filter((t) => now - t < B.windowSeconds * 1000), now]
          next = failures.length >= B.failureThreshold ? open(B.cooldownSeconds) : { ...b, failures }
        }
      }
      if (next) tx.set(ref(), { ...next, ...stamp() })
    })
  } catch (e) { /* the breaker could not be updated: the next admit() reads the old state; nothing else depends on this */ }
}
// An admitted call that never reached the provider (e.g. the user's allowance ran out first): give the probe lease / recovery slot back.
async function release({ owner, mode }) {
  if (mode === "normal") return
  try {
    await fb.db().runTransaction(async (tx) => {
      const s = await tx.get(ref())
      if (!s.exists) return
      const b = { ...closed(), ...s.data() }
      if (mode === "probe" && b.state === "half_open" && b.lease && b.lease.owner === owner) tx.set(ref(), { ...b, lease: null, ...stamp() })
      else if (mode === "recovery" && b.state === "recovery") { const inflight = { ...(b.inflight || {}) }; delete inflight[owner]; tx.set(ref(), { ...b, inflight, ...stamp() }) }
    })
  } catch (e) { /* the lease expires by itself */ }
}
module.exports = { admit, report, release, peek, closed }
