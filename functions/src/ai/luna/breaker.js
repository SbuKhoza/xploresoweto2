"use strict"
// Provider-level circuit breaker, shared by every instance through ONE Firestore document (ai-usage/luna-breaker).
//   closed    -> normal operation (the hot path only READS this document; it is written on failures and state changes only)
//   open      -> cooldown after repeated transient failures or a rate limit; Luna is not called
//   half_open -> cooldown over: exactly ONE probe in the whole system holds a lease (an expiring lease, so a crashed probe cannot deadlock it)
//   recovery  -> probe succeeded: a limited number of concurrent calls (globally, tracked here) for a short window, then closed
//   blocked   -> billing/quota or bad-key problem: no automatic retries; stays blocked until an operator bumps luna.resetEpoch
// If this document cannot be read, Luna is treated as OFF and Malloya answers deterministically.
//
// FAIL-CLOSED on a lost update. A provider outcome that cannot be committed to the breaker must never silently allow more paid calls:
//   1. report() retries the transaction once.
//   2. If that fails too, the event is written as its own durable "hold" document (ai-usage/luna_h_{owner}; a plain set, no read-modify-write, so it
//      does not share the failure mode of the hot breaker document) and this instance also stops calling Luna for LOCAL_HOLD_MS (in memory, an extra
//      layer only).
//   3. EVERY instance's admit() lists the hold documents first. While any exists, nobody is admitted. admit() replays the held events into the
//      breaker in one transaction (the same pure reducer report() uses) and deletes them. If that replay fails, admit() denies again.
//   Residual case: the transaction AND the hold write both fail (Firestore broadly unavailable). Then only the in-memory hold protects this instance,
//   but the same outage makes every other instance's admit() unable to read the breaker, which denies as well. Documented in LUNA_PHASE1.md.
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")
const { AI_COL } = require("../constants")
const { sha256hex } = require("../../lib/crypto")
const { KINDS, INVALID_OUTPUT, INPUT_OVERRUN_LIMIT, MAX_COOLDOWN_SECONDS, COOLDOWN_STEPS, CONSECUTIVE_FAILURES, LOCAL_HOLD_MS } = require("./constants")

const ref = () => fb.db().collection(AI_COL.usage).doc("luna-breaker")
const closed = (epoch = 0) => ({ state: "closed", failures: [], consecutive: 0, invalid: [], overruns: 0, cooldownStep: 0, cooldownSeconds: 0, cooldownUntil: 0, lease: null, recoveryUntil: 0, inflight: {}, blockedKind: null, resetEpoch: epoch })
const stamp = () => ({ updatedAt: fb.FieldValue().serverTimestamp() })
const MAX_COOLDOWN = MAX_COOLDOWN_SECONDS
// The breaker owner (probe lease / recovery slot holder) is derived from BOTH the uid and the requestId. requestId alone is client-chosen:
// two users sending the same requestId would otherwise share one slot and walk past the global recovery cap.
const ownerKey = (uid, requestId) => sha256hex(JSON.stringify(["owner", String(uid), String(requestId)])).slice(0, 32)

const holdRef = (owner) => fb.db().collection(AI_COL.usage).doc(`luna_h_${owner}`)
let localHoldUntil = 0 // in-memory extra layer only; the durable protection is the hold documents
const resetLocalForTests = () => { localHoldUntil = 0 }

async function peek() { // -> breaker data | null when unreadable
  try { const s = await ref().get(); return s.exists ? { ...closed(), ...s.data() } : closed() } catch (e) { return null }
}

// -> { allowed, mode: "normal"|"probe"|"recovery", reason? }
async function admit({ owner, cfg }) {
  const B = cfg.luna.breaker, epoch = cfg.luna.resetEpoch || 0
  let holds
  try { holds = (await fb.db().collection(AI_COL.usage).where("lunaHold", "==", true).limit(50).get()).docs } catch (e) { return { allowed: false, reason: "breaker-unreadable" } }
  if (holds.length) { // a breaker update was lost earlier: replay it before anything else, or stay closed to Luna
    if (!(await reconcile(holds.map((d) => d.id), cfg))) return { allowed: false, reason: "breaker-update-pending" }
    localHoldUntil = 0
  }
  if (clock.now().getTime() < localHoldUntil) return { allowed: false, reason: "breaker-update-pending" } // the hold document itself could not be written
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

// Pure reducer: (breaker state, one provider outcome) -> the document to write, or null for "no change". Used by report() and by the hold replay.
//   ok:true   the PROVIDER behaved. `rejected` = our strict validator refused the text; `overrun` = the provider reported more input tokens than the limit.
//   ok:false  provider failure, classified by `kind` (see KINDS).
// Failures: a counted failure opens the breaker on EITHER 3 in a row (`consecutive`; any provider response resets it) OR failureThreshold (5) within windowSeconds (60).
// Cooldown ladder: 60, 120, 300, 600, 900 s. First opening = step 0; each failed probe / failed recovery call = the next step; it stays at 900 until the breaker closes.
// Cross-call bookkeeping kept across state changes and cleared only by a reset to closed:
//   invalid  last N validated responses, 1 = rejected. INVALID_OUTPUT.threshold of the last INVALID_OUTPUT.window opens the breaker for 15 minutes.
//   overruns number of input-overrun reports. INPUT_OVERRUN_LIMIT of them hard-block Luna until an operator bumps luna.resetEpoch.
function reduce(b, ev, cfg, now) {
  const B = cfg.luna.breaker, epoch = cfg.luna.resetEpoch || 0
  const { owner, mode, ok, kind, retryAfterSeconds, rejected = false, overrun = false } = ev
  const rule = ok ? null : (KINDS[kind] || KINDS.server).breaker
  const openStep = (idx, retry = 0) => {
    const i = Math.min(Math.max(idx, 0), COOLDOWN_STEPS.length - 1), secs = Math.min(MAX_COOLDOWN_SECONDS, Math.max(COOLDOWN_STEPS[i], retry || 0))
    return { ...b, state: "open", failures: [], consecutive: 0, lease: null, inflight: {}, cooldownStep: i, cooldownSeconds: secs, cooldownUntil: now + secs * 1000 }
  }
  const block = (why) => ({ ...closed(b.resetEpoch || epoch), state: "blocked", blockedKind: why, resetEpoch: Math.max(b.resetEpoch || 0, epoch) })
  const nextStep = (b.cooldownStep || 0) + 1
  let next = null
  if (mode === "probe") {
    if (ok) next = { ...closed(b.resetEpoch || 0), state: "recovery", cooldownStep: b.cooldownStep || 0, recoveryUntil: now + B.recoverySeconds * 1000 }
    else if (rule === "blocked") next = block(kind)
    else next = openStep(nextStep, retryAfterSeconds)
  } else if (mode === "recovery") {
    const inflight = { ...(b.inflight || {}) }; delete inflight[owner]
    if (ok) next = b.state === "recovery" ? { ...b, inflight } : null
    else if (rule === "blocked") next = block(kind)
    else next = openStep(nextStep, retryAfterSeconds)
  } else if (b.state === "closed") { // normal-mode failure
    if (rule === "blocked") next = block(kind)
    else if (rule === "open") next = openStep(0, retryAfterSeconds)
    else if (!ok) {
      const failures = [...(b.failures || []).filter((t) => now - t < B.windowSeconds * 1000), now], consecutive = (b.consecutive || 0) + 1
      next = consecutive >= CONSECUTIVE_FAILURES || failures.length >= B.failureThreshold ? openStep(0) : { ...b, failures, consecutive }
    }
  }
  if (b.state === "blocked" && !next) return null // an operator-only state: late reports change nothing
  if (!ok) return next
  // ---- a provider response arrived: cross-call bookkeeping ----
  const W = INVALID_OUTPUT.window
  let invalid = [...(b.invalid || []), rejected ? 1 : 0].slice(-W)
  const overruns = (b.overruns || 0) + (overrun ? 1 : 0)
  if (!invalid.includes(1)) invalid = [] // nothing rejected in the window: keep the document small
  let cur = { ...(next || b), invalid, overruns, consecutive: 0 } // any answer from the provider ends a run of consecutive failures
  if (overruns >= INPUT_OVERRUN_LIMIT) cur = block("input_overrun")
  else if (cur.state !== "open" && cur.state !== "blocked" && invalid.reduce((a, x) => a + x, 0) >= INVALID_OUTPUT.threshold) {
    cur = { ...cur, state: "open", failures: [], invalid: [], lease: null, inflight: {}, cooldownStep: COOLDOWN_STEPS.length - 1, cooldownSeconds: INVALID_OUTPUT.cooldownSeconds, cooldownUntil: now + INVALID_OUTPUT.cooldownSeconds * 1000, blockedKind: null }
  }
  return cur
}

const evOf = ({ owner, mode, ok, kind, retryAfterSeconds, rejected = false, overrun = false }) => ({ owner, mode, ok: !!ok, kind: kind || null, retryAfterSeconds: retryAfterSeconds || 0, rejected: !!rejected, overrun: !!overrun })

async function commitEvent(ev, cfg) { // one transaction; throws on failure
  await fb.db().runTransaction(async (tx) => {
    const s = await tx.get(ref())
    const b = s.exists ? { ...closed(), ...s.data() } : closed()
    const next = reduce(b, ev, cfg, clock.now().getTime())
    if (next) tx.set(ref(), { ...next, ...stamp() })
  })
}

// Record the outcome of an admitted call. Never throws. A lost update fails CLOSED (see the header): hold document + local hold.
async function report(args) {
  const cfg = args.cfg, ev = evOf(args)
  if (ev.mode === "normal" && ev.ok && !ev.rejected && !ev.overrun) { // hot path: write only when there is bookkeeping to update
    const cur = await peek()
    if (cur && cur.state === "closed" && !(cur.invalid || []).length && !(cur.consecutive > 0)) return
  }
  for (let attempt = 0; attempt < 2; attempt++) { try { await commitEvent(ev, cfg); return } catch (e) { /* retry once, then fail closed */ } }
  localHoldUntil = clock.now().getTime() + LOCAL_HOLD_MS
  try { await holdRef(ev.owner).set({ lunaHold: true, ev, epoch: cfg.luna.resetEpoch || 0, at: clock.now().getTime(), ...stamp() }) } catch (e) { /* only the local hold remains; see the residual case in the header */ }
}

// Replay held events into the breaker and delete them, in ONE transaction. Events from before an operator reset (older epoch) are dropped.
// A hold document that cannot be understood is replayed as the most conservative event (a counted failure that opens the breaker).
async function reconcile(ids, cfg) {
  try {
    await fb.db().runTransaction(async (tx) => {
      const s = await tx.get(ref()); let b = s.exists ? { ...closed(), ...s.data() } : closed(), changed = false
      const docs = []
      for (const id of ids) { const h = await tx.get(fb.db().collection(AI_COL.usage).doc(id)); if (h.exists) docs.push({ id, d: h.data() }) }
      docs.sort((x, y) => (x.d.at || 0) - (y.d.at || 0))
      const now = clock.now().getTime(), epoch = cfg.luna.resetEpoch || 0
      for (const { d } of docs) {
        if ((d.epoch || 0) < epoch) continue
        const corrupt = !(d.ev && typeof d.ev === "object")
        const ev = corrupt ? { owner: "unknown", mode: "normal", ok: false, kind: "server" } : d.ev
        const base = corrupt && b.state === "closed" ? { ...b, consecutive: CONSECUTIVE_FAILURES - 1 } : b // unknown event: make it open the breaker
        const next = reduce(base, ev, cfg, now); if (next) { b = next; changed = true }
      }
      if (changed) tx.set(ref(), { ...b, ...stamp() })
      for (const { id } of docs) tx.delete(fb.db().collection(AI_COL.usage).doc(id))
    })
    return true
  } catch (e) { return false }
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
module.exports = { admit, report, release, peek, closed, ownerKey, reduce, resetLocalForTests }
