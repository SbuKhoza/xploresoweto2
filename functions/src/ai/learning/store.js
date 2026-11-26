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
const { AI_COL } = require("../constants")
const { validSignature } = require("./screen")
const { PII_PATTERNS, SENSITIVE, LEARNABLE_INTENTS } = require("./vocab")

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
async function recordSignal({ uid, kind, sig, hintIntent = null, suggestedIntent = null, dedupeKey = "", cfg }) {
  const L = cfg.learning
  if (!L || L.collect !== true || L.privacyAcknowledged !== true) return { recorded: false, reason: "off" }
  if (!KINDS.includes(kind) || !validSignature(sig)) return { recorded: false, reason: "invalid" }
  const now = clock.now(), day = dayOf(now)
  const hint = typeof hintIntent === "string" && /^[a-z_]{3,30}$/.test(hintIntent) ? hintIntent : null
  const sugg = LEARNABLE_INTENTS.includes(suggestedIntent) ? suggestedIntent : null
  const key = sha(`${kind}|${sig}|${dedupeKey}`).slice(0, 12)
  const db = fb.db()
  const seenRef = db.collection(AI_COL.seen).doc(`${uid}_${day}`), gRef = db.collection(AI_COL.seen).doc(`g_${day}`), cRef = db.collection(AI_COL.candidates).doc(candId(kind, sig))
  return db.runTransaction(async (tx) => {
    const [seen, g, cand] = [await tx.get(seenRef), await tx.get(gRef), await tx.get(cRef)]
    const s = seen.exists ? seen.data() : { n: 0, keys: [] }
    if (s.n >= L.maxPerUserPerDay) return { recorded: false, reason: "user-cap" }
    if ((s.keys || []).includes(key)) return { recorded: false, reason: "duplicate" }
    const gn = g.exists ? g.data().n : 0
    const exp = ts(now.getTime() + L.candidateRetentionDays * 86400000)
    if (cand.exists) {
      const c = cand.data(), sg = { ...(c.suggestions || {}) }
      if (sugg) sg[sugg] = (sg[sugg] || 0) + 1
      tx.set(cRef, { ...c, count: c.count + 1, lastDay: day, suggestions: sg, expireAt: exp, updatedAt: fb.FieldValue().serverTimestamp() })
    } else {
      if (gn >= L.maxNewPerDay) return { recorded: false, reason: "daily-cap" }
      tx.set(cRef, { kind, sig, hintIntent: hint, suggestions: sugg ? { [sugg]: 1 } : {}, count: 1, firstDay: day, lastDay: day, status: "new", expireAt: exp, createdAt: fb.FieldValue().serverTimestamp(), updatedAt: fb.FieldValue().serverTimestamp() })
      tx.set(gRef, { n: gn + 1, expireAt: ts(now.getTime() + SEEN_DAYS * 86400000) })
    }
    tx.set(seenRef, { ownerUid: uid, n: s.n + 1, keys: [...(s.keys || []), key].slice(-30), expireAt: ts(now.getTime() + SEEN_DAYS * 86400000) })
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
// Account erasure. Candidates hold no uid and no text, so a single contribution cannot be picked out and withdrawn: that is documented.
async function eraseUser(uid) {
  let seen = 0
  await optRef(uid).delete()
  for (;;) {
    const snap = await fb.db().collection(AI_COL.seen).where("ownerUid", "==", uid).limit(100).get()
    if (snap.empty) return { seen }
    for (const d of snap.docs) { await d.ref.delete(); seen += 1 }
  }
}

// ---- review ---------------------------------------------------------------------------------------------------------------------------
const candView = (id, c) => ({ id, kind: c.kind, signature: c.sig, hintIntent: c.hintIntent || null, suggestedIntents: c.suggestions || {}, count: c.count, firstDay: c.firstDay, lastDay: c.lastDay, status: c.status,
  ...(c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}), ...(c.reason ? { reason: c.reason } : {}) })
async function listCandidates({ status = "new", kind = null, limit = 50 }) {
  const snap = await fb.db().collection(AI_COL.candidates).where("status", "==", status).limit(500).get()
  return snap.docs.filter((d) => !kind || d.data().kind === kind).map((d) => candView(d.id, d.data())).sort((a, b) => b.count - a.count || (a.lastDay < b.lastDay ? 1 : -1)).slice(0, limit)
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
    if (!partial || p.alias !== undefined) { if (typeof p.alias !== "string" || !ALIAS.test(p.alias) || p.alias.length < 3 || p.alias.length > 40 || SENSITIVE.test(p.alias)) throw bad("invalid-alias"); out.alias = p.alias }
    if (!partial || p.canonical !== undefined) { if (typeof p.canonical !== "string" || p.canonical.length < 3 || p.canonical.length > 60 || /[\u0000-\u001f<>]/.test(p.canonical)) throw bad("invalid-canonical"); out.canonical = p.canonical.trim() }
  }
  return out
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
  const id = knowId(type, keyOf(type, fields)), kRef = fb.db().collection(AI_COL.knowledge).doc(id)
  const k = { type, status: "active", version: 1, ...fields, ...(sourceCandidate ? { sourceCandidate } : {}), createdBy: actorUid, updatedBy: actorUid, createdAt: fb.FieldValue().serverTimestamp(), updatedAt: fb.FieldValue().serverTimestamp() }
  return { id, kRef, k }
}
async function reviewCandidate({ id, decision, actorUid, type, payload, reason, audit }) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw bad("invalid-id")
  if (decision !== "approve" && decision !== "reject") throw bad("invalid-decision")
  if (decision === "approve" && type === "place_alias") throw bad("place-alias-is-created-directly") // a candidate has no place name to approve (names are never stored)
  const fields = decision === "approve" ? cleanPayload(type, payload) : null
  const rsn = decision === "reject" ? reasonOf(reason) : null
  const cRef = fb.db().collection(AI_COL.candidates).doc(id)
  return fb.db().runTransaction(async (tx) => {
    const c = await tx.get(cRef)
    if (!c.exists) throw new HttpsError("not-found", "candidate-not-found")
    const cd = c.data()
    if (cd.status !== "new") throw new HttpsError("failed-precondition", "already-reviewed")
    const now = clock.now()
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
async function purge({ scope, olderThanDays }) {
  if (!["expired", "rejected", "new", "all"].includes(scope)) throw bad("invalid-scope")
  const now = clock.now().getTime()
  const snap = await fb.db().collection(AI_COL.candidates).limit(400).get()
  const doomed = snap.docs.filter((d) => { const c = d.data(); return scope === "all" || (scope === "expired" ? c.expireAt && c.expireAt.toMillis() <= now : scope === "rejected" ? c.status === "rejected" : c.status === "new") })
  const b = fb.db().batch()
  doomed.forEach((d) => b.delete(d.ref))
  await b.commit()
  return { deleted: doomed.length, more: snap.docs.length >= 400 }
}
module.exports = { KINDS, TYPES, REASONS, candId, knowId, recordSignal, isOptedOut, setOptOut, eraseUser, listCandidates, reviewCandidate, createKnowledge, updateKnowledge, listKnowledge, knowledgeHistory, stats, purge, cleanPayload }
