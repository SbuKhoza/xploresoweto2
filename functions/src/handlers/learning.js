"use strict"
// Reviewed-learning callables. Contracts: docs/malloya/LEARNING.md.
//   User:  aiSubmitFeedback, aiSetLearningOptOut                          (authenticated + verified email; own conversation only)
//   Admin: aiAdminListLearningCandidates, aiAdminReviewCandidate, aiAdminListKnowledge, aiAdminKnowledgeHistory, aiAdminSaveKnowledge,
//          aiAdminUpdateKnowledge, aiAdminLearningStats, aiAdminPurgeLearning   (ACTIVE Super Admin: claim + verified email + active record, checked here, on the server)
// Learning settings are changed through the existing aiAdminUpdateConfig (`learning` key). Every state change is audited in the same transaction.
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")
const cfgMod = require("../ai/config")
const conv = require("../ai/conversations")
const store = require("../ai/learning/store")
const capture = require("../ai/learning/capture")
const knowledge = require("../ai/learning/knowledge")
const { CORRECTION_INTENTS } = require("../ai/learning/vocab")
const { loadPlaces } = require("../ai/retrieval/listings")
const { LANDMARKS } = require("../ai/engine/landmarks")
const clock = require("../lib/clock")

const verified = async (request) => G.requireVerified(await G.requireAuth(request))
const bad = (m) => new HttpsError("invalid-argument", m)
const CID = /^c_[a-f0-9]{24}$/
const auditFor = (actorUid) => (tx, e) => writeAudit(tx, { action: e.action, actorUid, details: e.details })

// ---- user ------------------------------------------------------------------------------------------------------------------------------
async function aiSubmitFeedback(request) {
  const ctx = await verified(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["conversationId", "messageId", "rating", "correctionIntent"])
  if (typeof d.conversationId !== "string" || !CID.test(d.conversationId)) throw bad("invalid-conversation-id")
  if (typeof d.messageId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(d.messageId)) throw bad("invalid-message-id")
  V.oneOf(d.rating, "rating", ["helpful", "unhelpful"])
  if (d.correctionIntent !== undefined && !CORRECTION_INTENTS.includes(d.correctionIntent)) throw bad("invalid-correction")
  const cfg = await cfgMod.getAiConfig()
  if (!cfg.learning.collect || !cfg.learning.privacyAcknowledged) return { recorded: false, reason: "off" } // nothing is read or kept while learning is off
  const c = await conv.getConversation(ctx.uid, d.conversationId, 200) // own conversation only; someone else's looks missing
  const i = c.messages.findIndex((m) => m.id === d.messageId && m.role === "assistant")
  if (i < 1 || c.messages[i - 1].role !== "user") throw new HttpsError("not-found", "message-not-found")
  const r = await capture.fromFeedback({ uid: ctx.uid, userText: c.messages[i - 1].text, messageId: d.messageId, rating: d.rating, correctionIntent: d.correctionIntent, hintIntent: c.messages[i].intent || null, cfg })
  return { recorded: r.recorded === true, ...(r.recorded ? {} : { reason: r.reason }) }
}
async function aiSetLearningOptOut(request) {
  const ctx = await verified(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["optOut"])
  if (typeof d.optOut !== "boolean") throw bad("invalid-optOut")
  return { optOut: await store.setOptOut(ctx.uid, d.optOut) }
}

// ---- Super Admin ---------------------------------------------------------------------------------------------------------------------------
const lim = (v, def = 50) => (v === undefined ? def : V.intRange(v, "limit", 1, 200))
async function aiAdminListLearningCandidates(request) {
  await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data ?? {})
  V.onlyKeys(d, ["status", "kind", "limit"])
  const status = d.status === undefined ? "new" : V.oneOf(d.status, "status", ["new", "approved", "rejected"])
  const kind = d.kind === undefined ? null : V.oneOf(d.kind, "kind", store.KINDS)
  return { candidates: await store.listCandidates({ status, kind, limit: lim(d.limit) }) }
}
async function aiAdminReviewCandidate(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["candidateId", "decision", "type", "payload", "reason"])
  const out = await store.reviewCandidate({ id: d.candidateId, decision: d.decision, actorUid: actor.uid, type: d.type, payload: d.payload, reason: d.reason, audit: auditFor(actor.uid) })
  knowledge.invalidate()
  return out
}
async function checkAlias(payload) { // a learned alias may only point at a place Malloya already knows: a built-in landmark or a stored township
  const canonical = payload && payload.canonical
  const known = new Set(LANDMARKS.map((l) => l.name.toLowerCase()))
  try { (await loadPlaces({ cfg: await cfgMod.getAiConfig(), now: clock.now(), location: null })).forEach((p) => known.add(String(p).toLowerCase())) } catch (e) { /* landmarks only */ }
  if (typeof canonical !== "string" || !known.has(canonical.trim().toLowerCase())) throw bad("unknown-canonical-place")
}
async function aiAdminSaveKnowledge(request) { // create directly (answers, phrases, place aliases)
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["type", "payload"])
  if (d.type === "place_alias") await checkAlias(d.payload)
  const out = await store.createKnowledge({ type: d.type, payload: d.payload, actorUid: actor.uid, audit: auditFor(actor.uid) })
  knowledge.invalidate()
  return out
}
async function aiAdminUpdateKnowledge(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["knowledgeId", "action", "payload", "reason"])
  if (d.action === "edit" && d.payload && d.payload.canonical !== undefined) await checkAlias(d.payload)
  const out = await store.updateKnowledge({ id: d.knowledgeId, action: d.action, payload: d.payload, reason: d.reason, actorUid: actor.uid, audit: auditFor(actor.uid) })
  knowledge.invalidate() // this instance stops using it at once; other instances within the 60 s cache window
  return out
}
async function aiAdminListKnowledge(request) {
  await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data ?? {})
  V.onlyKeys(d, ["status", "type", "limit"])
  const status = d.status === undefined ? null : V.oneOf(d.status, "status", ["active", "disabled", "revoked"])
  const type = d.type === undefined ? null : V.oneOf(d.type, "type", store.TYPES)
  return { knowledge: await store.listKnowledge({ status, type, limit: lim(d.limit) }) }
}
async function aiAdminKnowledgeHistory(request) {
  await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["knowledgeId"])
  return { versions: await store.knowledgeHistory(d.knowledgeId) }
}
async function aiAdminLearningStats(request) {
  await G.requireActiveSuperAdmin(request)
  const cfg = await cfgMod.getAiConfig()
  return { learning: cfg.learning, ...(await store.stats()) }
}
async function aiAdminPurgeLearning(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["scope", "confirm"])
  if (d.scope === "all" && d.confirm !== "DELETE-ALL-CANDIDATES") throw bad("confirmation-required")
  const r = await store.purge({ scope: d.scope })
  const b = fb.db().batch()
  writeAudit(b, { action: "ai.learning.purge", actorUid: actor.uid, details: { scope: d.scope, deleted: r.deleted } })
  await b.commit()
  return r
}
module.exports = { aiSubmitFeedback, aiSetLearningOptOut, aiAdminListLearningCandidates, aiAdminReviewCandidate, aiAdminSaveKnowledge, aiAdminUpdateKnowledge, aiAdminListKnowledge, aiAdminKnowledgeHistory, aiAdminLearningStats, aiAdminPurgeLearning }
