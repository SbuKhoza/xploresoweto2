"use strict"
// Storage for the reviewed-learning system. Everything here is SERVER-ONLY (the Admin SDK); client rules deny all four collections.
//   ai-learning-candidates/{id}     what Malloya could not answer, as a screened signature + a count. No uid, no text, no conversation id.
//   ai-knowledge/{id}(+/versions)   what a Super Admin approved. Versioned; can be disabled, re-enabled or revoked.
//   ai-learning-seen/{uid_day}      per-user, per-day throttle + de-duplication (hashes only). Holds the uid, so account erasure deletes it.
//   ai-learning-optout/{uid}        the user's own choice to be left out. Deleted on account erasure.
const crypto = require("crypto")
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")
const { writeAudit } = require("../../lib/audit")
const { AI_COL } = require("../constants")
const { validSignature } = require("./screen")
const { PII_PATTERNS, SENSITIVE, LEARNABLE_INTENTS, ALLOWED } = require("./vocab")
const { LANDMARKS } = require("../engine/landmarks")

const KINDS = Object.freeze(["unsupported_intent", "no_match", "missing_knowledge", "feedback_unhelpful", "feedback_correction"])
const TYPES = Object.freeze(["phrase_intent", "answer", "place_alias"])
const REASONS = Object.freeze(["not_useful", "unsafe", "duplicate", "out_of_scope", "incorrect", "outdated", "other"])
const SEEN_DAYS = 3
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex")
const dayOf = (d) => d.toISOString().slice(0, 10)
const ts = (ms) => fb.Timestamp().fromMillis(ms)
const bad = (m, extra) => new HttpsError("invalid-argument", m, extra)
const candId = (kind, sig) => sha(`${kind}|${sig}`).slice(0, 24)
const knowId = (type, key) => sha(`${type}|${key}`).slice(0, 24)

// ---- collection (best effort, bounded, throttled; the caller has already screened the text into `sig`) ---------------------------
// EVERYTHING that decides whether to record is read INSIDE the transaction: the stored settings (a collection switch-off or a lowered cap
// applies at once, not after the config cache expires), the user's opt-out, the per-event de-duplication record, the caps and the candidate.
// A concurrent opt-out / config write conflicts with this transaction, which then re-runs and sees it. `dedupeKey` is REQUIRED: it is the
// requestId (chat) or messageId (feedback), and the event record is not day-scoped, so a retry after midnight cannot count twice.
const expired = (c, nowMs) => !!(c.expireAt && c.expireAt.toMillis && c.expireAt.toMillis() <= nowMs)
async function recordSignal({ uid, kind, sig, hintIntent = null, suggestedIntent = null, dedupeKey }) {
  if (!KINDS.includes(kind) || !validSignature(sig) || typeof dedupeKey !== "string" || !dedupeKey || typeof uid !== "string" || !uid) return { recorded: false, reason: "invalid" }
  const hint = typeof hintIntent === "string" && /^[a-z_]{3,30}$/.test(hintIntent) ? hintIntent : null
  const sugg = LEARNABLE_INTENTS.includes(suggestedIntent) ? suggestedIntent : null
  const db = fb.db()
  const evId = sha(`${uid}|${kind}|${dedupeKey}`).slice(0, 32), sigKey = sha(`${kind}|${sig}`).slice(0, 12)
  const evRef = db.collection(AI_COL.events).doc(evId), cRef = db.collection(AI_COL.candidates).doc(candId(kind, sig))
  const cfgRef = db.collection(AI_COL.config).doc("default"), optRef2 = db.collection(AI_COL.optout).doc(uid)
  return db.runTransaction(async (tx) => {
    const now = clock.now(), nowMs = now.getTime(), day = dayOf(now)
    const seenRef = db.collection(AI_COL.seen).doc(`${uid}_${day}`), gRef = db.collection(AI_COL.seen).doc(`g_${day}`)
    const [cfgSnap, opt, ev, seen, g, cand] = [await tx.get(cfgRef), await tx.get(optRef2), await tx.get(evRef), await tx.get(seenRef), await tx.get(gRef), await tx.get(cRef)]
    const L = require("../config").effectiveFromStored(cfgSnap.exists ? cfgSnap.data() : null).learning
    if (L.collect !== true || L.privacyAcknowledged !== true) return { recorded: false, reason: "off" }
    if (opt.exists) return { recorded: false, reason: "opted-out" }
    if (ev.exists) return { recorded: false, reason: "duplicate" }
    const s = seen.exists ? seen.data() : { n: 0, keys: [] }
    if (s.n >= L.maxPerUserPerDay) return { recorded: false, reason: "user-cap" }
    if ((s.keys || []).includes(sigKey)) return { recorded: false, reason: "duplicate" } // the same user asking the same thing again today counts once
    const gn = g.exists ? g.data().n : 0
    const exp = ts(nowMs + L.candidateRetentionDays * 86400000)
    const live = cand.exists && !expired(cand.data(), nowMs) // an expired candidate is treated as absent: it restarts from 1 and must be reviewed afresh
    if (live) {
      const c = cand.data(), sg = { ...(c.suggestions || {}) }
      if (sugg) sg[sugg] = (sg[sugg] || 0) + 1
      tx.set(cRef, { ...c, count: c.count + 1, lastDay: day, suggestions: sg, expireAt: c.status === "new" ? exp : c.expireAt, updatedAt: fb.FieldValue().serverTimestamp() })
    } else {
      if (gn >= L.maxNewPerDay) return { recorded: false, reason: "daily-cap" }
      tx.set(cRef, { kind, sig, hintIntent: hint, suggestions: sugg ? { [sugg]: 1 } : {}, count: 1, firstDay: day, lastDay: day, status: "new", expireAt: exp, createdAt: fb.FieldValue().serverTimestamp(), updatedAt: fb.FieldValue().serverTimestamp() })
      tx.set(gRef, { n: gn + 1, expireAt: ts(nowMs + SEEN_DAYS * 86400000) })
    }
    tx.set(evRef, { ownerUid: uid, expireAt: ts(nowMs + 7 * 86400000) }) // long enough to cover any retry window; holds no text
    tx.set(seenRef, { ownerUid: uid, n: s.n + 1, keys: [...(s.keys || []), sigKey].slice(-30), expireAt: ts(nowMs + SEEN_DAYS * 86400000) })
    return { recorded: true }
  })
}

// ---- the user's own controls --------------------------------------------------------------------------------------------------------
const optRef = (uid) => fb.db().collection(AI_COL.optout).doc(uid)
async function isOptedOut(uid) { return (await optRef(uid).get()).exists }
async function setOptOut(uid, optedOut) {
  if (optedOut) await optRef(uid).set({ uid, optedOut: true, updatedAt: fb.FieldValue().serverTimestamp() })
  else await optRef(uid).delete()
  return optedOut
}
// Removes this user's learning bookkeeping (throttle + de-duplication records). The opt-out flag is a protective PREFERENCE: it is kept unless
// the account itself is being closed, so erasing data never silently re-enrols someone. Candidates hold no uid and no text, so a single
// contribution cannot be picked out and withdrawn: that is documented in the privacy notice.
async function eraseUser(uid, { accountClosed = false } = {}) {
  const out = { seen: 0, events: 0, optOut: false }
  if (accountClosed) { await optRef(uid).delete(); out.optOut = true }
  for (const [name, key] of [[AI_COL.seen, "seen"], [AI_COL.events, "events"]]) {
    for (;;) {
      const snap = await fb.db().collection(name).where("ownerUid", "==", uid).limit(100).get()
      if (snap.empty) break
      for (const d of snap.docs) { await d.ref.delete(); out[key] += 1 }
    }
  }
  return out
}

// ---- review ---------------------------------------------------------------------------------------------------------------------------
const candView = (id, c) => ({ id, kind: c.kind, signature: c.sig, hintIntent: c.hintIntent || null, suggestedIntents: c.suggestions || {}, count: c.count, firstDay: c.firstDay, lastDay: c.lastDay, status: c.status,
  ...(c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}), ...(c.reason ? { reason: c.reason } : {}) })
async function listCandidates({ status = "new", kind = null, limit = 50 }) {
  const snap = await fb.db().collection(AI_COL.candidates).where("status", "==", status).limit(500).get()
  const nowMs = clock.now().getTime()
  return snap.docs.filter((d) => (!kind || d.data().kind === kind) && !expired(d.data(), nowMs)).map((d) => candView(d.id, d.data())).sort((a, b) => b.count - a.count || (a.lastDay < b.lastDay ? 1 : -1)).slice(0, limit)
}

function cleanText(t) {
  if (typeof t !== "string") throw bad("invalid-text")
  const s = t.replace(/\s+/g, " ").trim()
  if (s.length < 10 || s.length > 500 || /[\u0000-\u001f\u007f<>]/.test(s) || PII_PATTERNS.some((re) => re.test(s.toLowerCase()))) throw bad("invalid-text")
  return s
}
const ALIAS = /^[a-z]+(?: [a-z]+){0,3}$/
// -> the fields stored for a type (and nothing else), or throws. `knownPlace(canonical)` is supplied by the caller (it reads the place list).
function cleanPayload(type, p, { partial = false } = {}) {
  if (!TYPES.includes(type)) throw bad("invalid-type")
  if (!p || typeof p !== "object" || Array.isArray(p)) throw bad("invalid-payload")
  const allowed = { phrase_intent: ["sigs", "intent"], answer: ["sigs", "text"], place_alias: ["alias", "canonical"] }[type]
  if (Object.keys(p).some((k) => !allowed.includes(k))) throw bad("invalid-payload")
  const out = {}
  if (allowed.includes("sigs") && (!partial || p.sigs !== undefined)) {
    if (!Array.isArray(p.sigs) || p.sigs.length < 1 || p.sigs.length > 5 || !p.sigs.every(validSignature)) throw bad("invalid-signature")
    out.sigs = [...new Set(p.sigs)].sort()
  }
  if (type === "phrase_intent" && (!partial || p.intent !== undefined)) { if (!LEARNABLE_INTENTS.includes(p.intent)) throw bad("intent-not-learnable"); out.intent = p.intent }
  if (type === "answer" && (!partial || p.text !== undefined)) out.text = cleanText(p.text)
  if (type === "place_alias") {
    if (!partial || p.alias !== undefined) {
      if (typeof p.alias !== "string" || !ALIAS.test(p.alias) || p.alias.length < 4 || p.alias.length > 40 || SENSITIVE.test(p.alias)) throw bad("invalid-alias")
      if (p.alias.split(" ").every((w) => ALLOWED.has(w))) throw bad("alias-too-generic") // "mall", "the park": ordinary words must never be rewritten into a place
      if (LANDMARKS.some((l) => l.aliases.includes(p.alias))) throw bad("alias-already-built-in")
      out.alias = p.alias }
    if (!partial || p.canonical !== undefined) { if (typeof p.canonical !== "string" || p.canonical.length < 3 || p.canonical.length > 60 || /[\u0000-\u001f<>]/.test(p.canonical)) throw bad("invalid-canonical"); out.canonical = p.canonical.trim() }
  }
  if (partial && !Object.keys(out).length) throw bad("invalid-payload") // an edit must change something
  return out
}
// No two non-revoked items may claim the same signature / alias (the engine would otherwise have to pick one). Bounded scan; the residual race
// between two simultaneous creates is documented, and the engine breaks any tie deterministically (lowest id).
async function assertUnique(type, fields, exceptId = null) {
  const snap = await fb.db().collection(AI_COL.knowledge).limit(500).get()
  for (const d of snap.docs) {
    const k = d.data()
    if (d.id === exceptId || k.status === "revoked") continue
    if (type === "place_alias") { if (k.type === "place_alias" && fields.alias !== undefined && k.alias === fields.alias) throw new HttpsError("already-exists", "alias-in-use") }
    else if (k.type === type && fields.sigs && (k.sigs || []).some((x) => fields.sigs.includes(x))) throw new HttpsError("already-exists", "signature-in-use")
  }
}
const keyOf = (type, f) => (type === "place_alias" ? f.alias : (f.sigs || []).join("|"))
const knowView = (id, k) => ({ id, type: k.type, status: k.status, version: k.version, ...(k.sigs ? { signatures: k.sigs } : {}), ...(k.intent ? { intent: k.intent } : {}), ...(k.text ? { text: k.text } : {}),
  ...(k.alias ? { alias: k.alias, canonical: k.canonical } : {}), ...(k.sourceCandidate ? { sourceCandidate: k.sourceCandidate } : {}), updatedAt: k.updatedAt && k.updatedAt.toMillis ? k.updatedAt.toMillis() : null })
const snapshot = (k) => Object.fromEntries(["type", "status", "sigs", "intent", "text", "alias", "canonical"].filter((f) => k[f] !== undefined).map((f) => [f, k[f]]))
const reasonOf = (r) => { if (!REASONS.includes(r)) throw bad("invalid-reason", { allowed: REASONS }); return r }

function writeVersion(tx, kRef, k, { action, actorUid, reason }) {
  tx.set(kRef.collection("versions").doc(String(k.version)), { version: k.version, snapshot: snapshot(k), action, actorUid, reason: reason || null, at: fb.FieldValue().serverTimestamp() })
}
// Create knowledge (from a reviewed candidate, or directly by a Super Admin). Always starts ACTIVE at version 1.
function createInTx(tx, { type, fields, actorUid, sourceCandidate = null }) {
  const id = crypto.randomBytes(12).toString("hex"), kRef = fb.db().collection(AI_COL.knowledge).doc(id)
  const k = { type, status: "active", version: 1, ...fields, ...(sourceCandidate ? { sourceCandidate } : {}), createdBy: actorUid, updatedBy: actorUid, createdAt: fb.FieldValue().serverTimestamp(), updatedAt: fb.FieldValue().serverTimestamp() }
  return { id, kRef, k }
}
async function reviewCandidate({ id, decision, actorUid, type, payload, reason, audit }) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw bad("invalid-id")
  if (decision !== "approve" && decision !== "reject") throw bad("invalid-decision")
  if (decision === "approve" && type === "place_alias") throw bad("place-alias-is-created-directly") // a candidate has no place name to approve (names are never stored)
  const fields = decision === "approve" ? cleanPayload(type, payload) : null
  const rsn = decision === "reject" ? reasonOf(reason) : null
  if (fields) await assertUnique(type, fields)
  const cRef = fb.db().collection(AI_COL.candidates).doc(id)
  return fb.db().runTransaction(async (tx) => {
    const c = await tx.get(cRef)
    if (!c.exists) throw new HttpsError("not-found", "candidate-not-found")
    const cd = c.data()
    if (cd.status !== "new") throw new HttpsError("failed-precondition", "already-reviewed")
    const now = clock.now()
    if (expired(cd, now.getTime())) throw new HttpsError("failed-precondition", "candidate-expired") // retention has passed: it can no longer be approved
    const keep = ts(now.getTime() + 365 * 86400000) // a reviewed candidate is kept for a year so the same text is not re-proposed
    if (decision === "reject") {
      tx.set(cRef, { ...cd, status: "rejected", reason: rsn, expireAt: keep, reviewedBy: actorUid, updatedAt: fb.FieldValue().serverTimestamp() })
      audit(tx, { action: "ai.learning.reject", details: { candidate: id, kind: cd.kind, reason: rsn } })
      return { status: "rejected" }
    }
    const { id: kid, kRef, k } = createInTx(tx, { type, fields, actorUid, sourceCandidate: id })
    if ((await tx.get(kRef)).exists) throw new HttpsError("already-exists", "knowledge-exists")
    tx.set(kRef, k); writeVersion(tx, kRef, k, { action: "create", actorUid })
    tx.set(cRef, { ...cd, status: "approved", knowledgeId: kid, expireAt: keep, reviewedBy: actorUid, updatedAt: fb.FieldValue().serverTimestamp() })
    audit(tx, { action: "ai.learning.approve", details: { candidate: id, knowledge: kid, type, version: 1 } })
    return { status: "approved", knowledgeId: kid }
  })
}
async function createKnowledge({ type, payload, actorUid, audit }) {
  const fields = cleanPayload(type, payload)
  await assertUnique(type, fields)
  return fb.db().runTransaction(async (tx) => {
    const { id, kRef, k } = createInTx(tx, { type, fields, actorUid })
    if ((await tx.get(kRef)).exists) throw new HttpsError("already-exists", "knowledge-exists")
    tx.set(kRef, k); writeVersion(tx, kRef, k, { action: "create", actorUid })
    audit(tx, { action: "ai.knowledge.create", details: { knowledge: id, type, version: 1 } })
    return { knowledgeId: id, version: 1 }
  })
}
async function updateKnowledge({ id, action, payload, reason, actorUid, audit }) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw bad("invalid-id")
  if (!["edit", "disable", "enable", "revoke"].includes(action)) throw bad("invalid-action")
  const rsn = action === "edit" || action === "enable" ? (reason === undefined ? null : reasonOf(reason)) : reasonOf(reason)
  const kRef = fb.db().collection(AI_COL.knowledge).doc(id)
  if (action === "edit" || action === "enable") { // re-activating or changing signatures must not collide with another live item
    const cur = await kRef.get()
    if (cur.exists && cur.data().status !== "revoked") await assertUnique(cur.data().type, action === "edit" ? cleanPayload(cur.data().type, payload, { partial: true }) : (cur.data().type === "place_alias" ? { alias: cur.data().alias } : { sigs: cur.data().sigs }), id)
  }
  return fb.db().runTransaction(async (tx) => {
    const s = await tx.get(kRef)
    if (!s.exists) throw new HttpsError("not-found", "knowledge-not-found")
    const k = s.data()
    if (k.status === "revoked") throw new HttpsError("failed-precondition", "revoked-is-final") // a revoked item is never brought back: create a new one
    let next = { ...k }
    if (action === "edit") next = { ...k, ...cleanPayload(k.type, payload, { partial: true }) }
    else if (action === "disable") { if (k.status === "disabled") return { version: k.version, status: k.status, unchanged: true }; next.status = "disabled" }
    else if (action === "enable") { if (k.status === "active") return { version: k.version, status: k.status, unchanged: true }; next.status = "active" }
    else next.status = "revoked"
    next = { ...next, version: k.version + 1, updatedBy: actorUid, updatedAt: fb.FieldValue().serverTimestamp() }
    tx.set(kRef, next); writeVersion(tx, kRef, next, { action, actorUid, reason: rsn })
    audit(tx, { action: `ai.knowledge.${action}`, details: { knowledge: id, type: k.type, version: next.version, reason: rsn } })
    return { version: next.version, status: next.status }
  })
}
async function listKnowledge({ status = null, type = null, limit = 50 }) {
  const col = fb.db().collection(AI_COL.knowledge)
  const snap = await (status ? col.where("status", "==", status) : col).limit(500).get()
  return snap.docs.filter((d) => !type || d.data().type === type).map((d) => knowView(d.id, d.data())).slice(0, limit)
}
async function knowledgeHistory(id) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw bad("invalid-id")
  const snap = await fb.db().collection(AI_COL.knowledge).doc(id).collection("versions").limit(100).get()
  return snap.docs.map((d) => { const v = d.data(); return { version: v.version, action: v.action, reason: v.reason, snapshot: v.snapshot, at: v.at && v.at.toMillis ? v.at.toMillis() : null } }).sort((a, b) => a.version - b.version)
}

// ---- aggregates and retention ------------------------------------------------------------------------------------------------------
const tally = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m }, {})
async function stats() {
  const c = (await fb.db().collection(AI_COL.candidates).limit(500).get()).docs.map((d) => d.data())
  const k = (await fb.db().collection(AI_COL.knowledge).limit(500).get()).docs.map((d) => d.data())
  const g = await fb.db().collection(AI_COL.seen).doc(`g_${dayOf(clock.now())}`).get()
  const top = c.filter((x) => x.status === "new").sort((a, b) => b.count - a.count).slice(0, 10).map((x) => ({ kind: x.kind, signature: x.sig, count: x.count }))
  return { candidates: { total: c.length, byStatus: tally(c, (x) => x.status), byKind: tally(c, (x) => x.kind), occurrences: c.reduce((n, x) => n + x.count, 0), top, truncated: c.length >= 500 },
    knowledge: { total: k.length, byStatus: tally(k, (x) => x.status), byType: tally(k, (x) => x.type), truncated: k.length >= 500 }, newCandidatesToday: g.exists ? g.data().n : 0 }
}
async function purge({ scope, actorUid }) {
  if (!["expired", "rejected", "new", "all"].includes(scope)) throw bad("invalid-scope")
  const now = clock.now().getTime()
  const snap = await fb.db().collection(AI_COL.candidates).limit(400).get()
  const doomed = snap.docs.filter((d) => { const c = d.data(); return scope === "all" || (scope === "expired" ? expired(c, now) : scope === "rejected" ? c.status === "rejected" : c.status === "new") })
  const b = fb.db().batch()
  doomed.forEach((d) => b.delete(d.ref))
  writeAudit(b, { action: "ai.learning.purge", actorUid, details: { scope, deleted: doomed.length } }) // the deletion and its audit entry commit together
  await b.commit()
  return { deleted: doomed.length, more: snap.docs.length >= 400 }
}
module.exports = { KINDS, TYPES, REASONS, candId, knowId, recordSignal, isOptedOut, setOptOut, eraseUser, listCandidates, reviewCandidate, createKnowledge, updateKnowledge, listKnowledge, knowledgeHistory, stats, purge, cleanPayload }
