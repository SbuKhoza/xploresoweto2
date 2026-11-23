"use strict"
// Provider-level circuit breaker, shared by every instance through ONE Firestore document (ai-usage/luna-breaker).
//   closed    -> normal operation (the hot path only READS this document; it is written on failures and state changes only)
//   open      -> cooldown after repeated transient failures or a rate limit; Luna is not called
//   half_open -> cooldown over: exactly ONE probe in the whole system holds a lease (an expiring lease, so a crashed probe cannot deadlock it)
//   recovery  -> probe succeeded: a limited number of concurrent calls (globally, tracked here) for a short window, then closed
//   blocked   -> billing/quota or bad-key problem: no automatic retries; stays blocked until an operator bumps luna.resetEpoch
// If this document cannot be read, Luna is treated as OFF and Malloya answers deterministically.
//
// FAIL-CLOSED on a lost update (round 4; replaces the round-3 hold documents). The durable obligation is the permanent request record that begin()
// commits BEFORE the provider call, marked `unresolved: true`:
//   * normal case: the breaker is updated, then the settle transaction clears `unresolved`.
//   * breaker update lost (report() retried once and still failed): the exact event rides on the record (`pendingEvent`) and `unresolved` stays true.
//   * every write lost, or the instance died: the record stays `called` + unresolved.
// EVERY instance's admit() queries the unresolved records IN PARALLEL with the breaker read and awaits both. Records that are still inside the grace
// period (UNRESOLVED.graceMs, measured from the server-committed `calledAt`) are genuinely in flight and ignored. Older ones are replayed into the breaker
// (a stored event exactly; an unknown outcome as the conservative `unreported` event that opens the breaker) and marked resolved IN THE SAME TRANSACTION,
// so a replay is atomic and idempotent even with concurrent reconcilers. Reconciliation is bounded (pages of 50, chunks of 20, at most 6 rounds); if the
// backlog is not proven empty, a page is incomplete, or any read/transaction fails, admit() DENIES. Residual: for up to the grace period after an outcome is
// lost, other instances can still admit calls; spend in that window is bounded by the per-user, global and per-instance limits.
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")
const { AI_COL } = require("../constants")
const { sha256hex } = require("../../lib/crypto")
const { KINDS, INVALID_OUTPUT, INPUT_OVERRUN_LIMIT, MAX_COOLDOWN_SECONDS, COOLDOWN_STEPS, CONSECUTIVE_FAILURES, LOCAL_HOLD_MS, UNRESOLVED } = require("./constants")

const ref = () => fb.db().collection(AI_COL.usage).doc("luna-breaker")
const closed = (epoch = 0) => ({ state: "closed", failures: [], consecutive: 0, invalid: [], overruns: 0, cooldownStep: 0, cooldownSeconds: 0, cooldownUntil: 0, lease: null, recoveryUntil: 0, inflight: {}, blockedKind: null, resetEpoch: epoch })
const stamp = () => ({ updatedAt: fb.FieldValue().serverTimestamp() })
const MAX_COOLDOWN = MAX_COOLDOWN_SECONDS
// The breaker owner (probe lease / recovery slot holder) is derived from BOTH the uid and the requestId. requestId alone is client-chosen:
// two users sending the same requestId would otherwise share one slot and walk past the global recovery cap.
const ownerKey = (uid, requestId) => sha256hex(JSON.stringify(["owner", String(uid), String(requestId)])).slice(0, 32)

let localHoldUntil = 0 // in-memory extra layer only; the durable protection is the unresolved request record
const resetLocalForTests = () => { localHoldUntil = 0 }

async function peek() { // -> breaker data | null when unreadable
  try { const s = await ref().get(); return s.exists ? { ...closed(), ...s.data() } : closed() } catch (e) { return null }
}

// -> { allowed, mode: "normal"|"probe"|"recovery", reason? }
async function admit({ owner, cfg }) {
  const B = cfg.luna.breaker, epoch = cfg.luna.resetEpoch || 0
  let page, first
  try { [page, first] = await Promise.all([queryUnresolved(), peek()]) } catch (e) { return { allowed: false, reason: "breaker-unreadable" } } // BOTH are awaited before any decision
  if (!first) return { allowed: false, reason: "breaker-unreadable" }
  const cleared = await clearUnresolved(page, cfg)
  if (!cleared.ok) return { allowed: false, reason: `unresolved-calls:${cleared.reason}` }
  if (cleared.reconciled) { localHoldUntil = 0; first = await peek(); if (!first) return { allowed: false, reason: "breaker-unreadable" } } // the replay may have changed the breaker
  if (clock.now().getTime() < localHoldUntil) return { allowed: false, reason: "breaker-update-pending" } // this instance lost a write and could not tell anyone
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
  // (1) An event from before an operator reset (earlier epoch than this instance's config OR than the breaker document) never changes anything:
  //     it can neither re-block nor re-open a system the operator just cleared.
  if ((Number.isInteger(ev.epoch) ? ev.epoch : epoch) < Math.max(epoch, b.resetEpoch || 0)) return null
  // (2) A blocked breaker is cleared ONLY by an operator reset (admit() sees a higher luna.resetEpoch). No event of any kind or age touches it.
  if (b.state === "blocked") return null
  const rule = ok ? null : (KINDS[kind] || KINDS.server).breaker
  const openStep = (idx, retry = 0) => {
    const i = Math.min(Math.max(idx, 0), COOLDOWN_STEPS.length - 1), secs = Math.min(MAX_COOLDOWN_SECONDS, Math.max(COOLDOWN_STEPS[i], retry || 0))
    return { ...b, state: "open", failures: [], consecutive: 0, lease: null, inflight: {}, cooldownStep: i, cooldownSeconds: secs, cooldownUntil: now + secs * 1000 }
  }
  const block = (why) => ({ ...closed(b.resetEpoch || epoch), state: "blocked", blockedKind: why, resetEpoch: Math.max(b.resetEpoch || 0, epoch) })
  const nextStep = (b.cooldownStep || 0) + 1
  // (3) OWNERSHIP. A probe / recovery outcome may change the state only while its owner still holds the live (unexpired) probe lease / recovery slot.
  //     A delayed outcome whose lease or slot has expired or been replaced is a "late" outcome: it is handled like an ordinary call (below).
  const holdsProbe = mode === "probe" && b.state === "half_open" && !!b.lease && b.lease.owner === owner && b.lease.expiresAt > now
  const holdsSlot = mode === "recovery" && b.state === "recovery" && ((b.inflight || {})[owner] || 0) > now
  let next = null
  if (holdsProbe) {
    if (ok) next = { ...closed(b.resetEpoch || 0), state: "recovery", cooldownStep: b.cooldownStep || 0, recoveryUntil: now + B.recoverySeconds * 1000 }
    else if (rule === "blocked") next = block(kind)
    else next = openStep(nextStep, retryAfterSeconds)
  } else if (holdsSlot) {
    const inflight = { ...(b.inflight || {}) }; delete inflight[owner]
    if (ok) next = { ...b, inflight }
    else if (rule === "blocked") next = block(kind)
    else next = openStep(nextStep, retryAfterSeconds)
  } else { // an ordinary call, or a late probe/recovery outcome
    if (!ok && rule === "blocked") next = block(kind) // a hard failure is true whenever it arrives (the safe direction); only an operator reset undoes it
    else if (!ok && b.state === "closed") { // everything else acts on a CLOSED breaker only: it counts as one ordinary failure
      if (rule === "open") next = openStep(0, retryAfterSeconds)
      else {
        const failures = [...(b.failures || []).filter((t) => now - t < B.windowSeconds * 1000), now], consecutive = (b.consecutive || 0) + 1
        next = consecutive >= CONSECUTIVE_FAILURES || failures.length >= B.failureThreshold ? openStep(0) : { ...b, failures, consecutive }
      }
    }
  }
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

const evOf = ({ owner, mode, ok, kind, retryAfterSeconds, rejected = false, overrun = false, cfg }) => ({ epoch: (cfg && cfg.luna && cfg.luna.resetEpoch) || 0, owner, mode, ok: !!ok, kind: kind || null, retryAfterSeconds: retryAfterSeconds || 0, rejected: !!rejected, overrun: !!overrun })

async function commitEvent(ev, cfg) { // one transaction; throws on failure
  await fb.db().runTransaction(async (tx) => {
    const s = await tx.get(ref())
    const b = s.exists ? { ...closed(), ...s.data() } : closed()
    const next = reduce(b, ev, cfg, clock.now().getTime())
    if (next) tx.set(ref(), { ...next, ...stamp() })
  })
}

// Record the outcome of an admitted call. Never throws. -> { reported: true } | { reported: false, event }.
// When the update is lost the caller stores `event` on the request record (see usage.settled); this instance also stops calling Luna for LOCAL_HOLD_MS
// (in memory: an extra layer only).
async function report(args) {
  const cfg = args.cfg, ev = evOf(args)
  if (ev.mode === "normal" && ev.ok && !ev.rejected && !ev.overrun) { // hot path: write only when there is bookkeeping to update
    const cur = await peek()
    if (cur && cur.state === "closed" && !(cur.invalid || []).length && !(cur.consecutive > 0)) return { reported: true }
  }
  for (let attempt = 0; attempt < 2; attempt++) { try { await commitEvent(ev, cfg); return { reported: true } } catch (e) { /* retry once, then fail closed */ } }
  localHoldUntil = clock.now().getTime() + LOCAL_HOLD_MS
  return { reported: false, event: ev }
}

// ---- unresolved paid calls -------------------------------------------------------------------------------------------------------------------------
const recRef = (id) => fb.db().collection(AI_COL.usage).doc(id)
const queryUnresolved = () => fb.db().collection(AI_COL.usage).where("unresolved", "==", true).limit(UNRESOLVED.page).get() // single-field equality: automatic index, no composite
const tsMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null)
// -> "young" (genuinely in flight: ignore) | "event" (a stored outcome to replay) | "stale" (unknown outcome) | "none"
function classify(d, now) {
  if (!d || d.unresolved !== true) return "none"
  if (d.pendingEvent && typeof d.pendingEvent === "object") return "event"
  if (d.state === "called") { const t = tsMs(d.calledAt); return t !== null && now - t <= UNRESOLVED.graceMs ? "young" : "stale" } // no usable committed timestamp -> stale
  return "stale" // unresolved but neither called nor carrying an event: corrupt, treated conservatively
}
const STALE_EVENT = (id) => ({ owner: `unreported:${id}`, mode: "normal", ok: false, kind: "unreported", retryAfterSeconds: 0, rejected: false, overrun: false })

// ONE transaction: re-read each record, apply its outcome to the breaker, mark it resolved. A record that is no longer unresolved (another
// reconciler got there first) or is young again is skipped, so every event is applied exactly once.
async function reconcileChunk(ids, cfg) {
  try {
    await fb.db().runTransaction(async (tx) => {
      const s = await tx.get(ref()); let b = s.exists ? { ...closed(), ...s.data() } : closed(), changed = false
      const found = []
      for (const id of ids) { const r = await tx.get(recRef(id)); if (r.exists) found.push({ id, d: r.data() }) }
      const now = clock.now().getTime()
      const todo = found.filter((x) => { const c = classify(x.d, now); return c === "event" || c === "stale" })
      todo.sort((x, y) => (tsMs(x.d.calledAt) || 0) - (tsMs(y.d.calledAt) || 0))
      for (const { id, d } of todo) {
        const isEvent = classify(d, now) === "event", ev = isEvent ? d.pendingEvent : { ...STALE_EVENT(id), epoch: d.epoch || 0 }
        const next = reduce(b, ev, cfg, now); if (next) { b = next; changed = true } // reduce() drops an event from before an operator reset, and applies the same ownership rules as a live report; the record is resolved either way
        const { unresolved, pendingEvent, ...rest } = d
        tx.set(recRef(id), { ...rest, ...(isEvent ? {} : { state: "unreported" }), resolvedBy: "reconcile", resolvedAt: fb.FieldValue().serverTimestamp() }) // permanent record kept
      }
      if (changed) tx.set(ref(), { ...b, ...stamp() })
    })
    return true
  } catch (e) { return false }
}

// Bounded, fail-closed reconciliation. -> { ok:true, reconciled } only when the backlog is PROVEN to contain nothing but in-flight calls.
async function clearUnresolved(firstPage, cfg) {
  let snap = firstPage, reconciled = false
  for (let round = 0; round <= UNRESOLVED.maxRounds; round++) {
    const now = clock.now().getTime(), rows = snap.docs.map((d) => ({ id: d.id, d: d.data() }))
    const actionable = rows.filter((r) => { const c = classify(r.d, now); return c === "event" || c === "stale" })
    if (!actionable.length) return rows.length >= UNRESOLVED.page ? { ok: false, reason: "incomplete" } : { ok: true, reconciled } // a full page of young rows cannot prove there is nothing behind it
    if (round === UNRESOLVED.maxRounds) return { ok: false, reason: "backlog" }
    for (let i = 0; i < actionable.length; i += UNRESOLVED.chunk) {
      if (!(await reconcileChunk(actionable.slice(i, i + UNRESOLVED.chunk).map((r) => r.id), cfg))) return { ok: false, reason: "reconcile-failed" }
      reconciled = true
    }
    try { snap = await queryUnresolved() } catch (e) { return { ok: false, reason: "unreadable" } }
  }
  return { ok: false, reason: "backlog" }
}

// Called as the FIRST read of begin()'s transaction, i.e. in the same serialisable transaction that commits `called`. admit() decided on a snapshot that may be a
// round trip old; this re-checks the breaker at the commit point, so a call cannot start after the breaker opened or blocked, or after its probe lease /
// recovery slot expired or was replaced. -> { ok:true } | { ok:false, reason }
async function guardInTx(tx, { owner, mode, cfg }) {
  const s = await tx.get(ref()), b = s.exists ? { ...closed(), ...s.data() } : closed(), now = clock.now().getTime()
  if (b.state === "blocked") return { ok: false, reason: "breaker-blocked" }
  if (mode === "normal") return b.state === "closed" ? { ok: true } : { ok: false, reason: "breaker-changed" }
  if (mode === "probe") return b.state === "half_open" && b.lease && b.lease.owner === owner && b.lease.expiresAt > now ? { ok: true } : { ok: false, reason: "breaker-changed" }
  if (mode === "recovery") return b.state === "recovery" && ((b.inflight || {})[owner] || 0) > now ? { ok: true } : { ok: false, reason: "breaker-changed" }
  return { ok: false, reason: "breaker-changed" }
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
module.exports = { admit, report, release, peek, closed, ownerKey, reduce, guardInTx, resetLocalForTests, classify }
