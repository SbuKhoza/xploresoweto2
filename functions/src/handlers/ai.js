"use strict"
// AI callables. Every one: authenticated + VERIFIED email, strict input validation, authorisation on the server.
// Users only ever reach their own conversations (ownership is re-checked in conversations.js; a foreign id looks like a missing one).
// Admin callables require an ACTIVE Super Admin (claim + verified email + active record), and every change is audited.
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")
const clock = require("../lib/clock")
const { AI_COL, LEARNING_NOTICE_VERSION } = require("../ai/constants")
const cfgMod = require("../ai/config")
const limits = require("../ai/ratelimit")
const conv = require("../ai/conversations")
const { runChat } = require("../ai/chat")
const consent = require("../ai/consent")
const erasure = require("../ai/erasure")
const learningStore = require("../ai/learning/store")
const lunaUsage = require("../ai/luna/usage")
const lunaBreaker = require("../ai/luna/breaker")
const { NOTICE_VERSION } = require("../ai/luna/constants")
const { hydrateRefs } = require("../ai/retrieval/cards")

const verified = async (request) => G.requireVerified(await G.requireAuth(request))
const CID = /^c_[a-f0-9]{24}$/
const cidOf = (v) => { if (typeof v !== "string" || !CID.test(v)) throw new HttpsError("invalid-argument", "invalid-conversation-id"); return v }

async function aiChat(request) {
  const ctx = await verified(request)
  const cfg = await cfgMod.getAiConfig()
  return runChat({ uid: ctx.uid, data: request.data, cfg })
}
async function aiGetUsage(request) {
  const ctx = await verified(request)
  const cfg = await cfgMod.getAiConfig()
  // Luna wording layer: what the app needs to show the notice and the user's own choice. Never fails the usage call.
  let lunaInfo = { available: false, noticeVersion: NOTICE_VERSION, consent: { active: false } }
  try { if (cfg.luna.enabled) lunaInfo = { available: true, noticeVersion: NOTICE_VERSION, consent: { active: (await consent.getConsent(ctx.uid)).active }, ...(await lunaUsage.userStatus(ctx.uid, cfg)) } } catch (e) { /* keep the default */ }
  // What the app may show for learning. `available` is true ONLY when a Super Admin has switched collection on (and recorded the privacy gate);
  // `optedOut` is the user's own server-side choice, shown even while collection is off so it is never lost.
  let learningInfo = { available: false, noticeVersion: LEARNING_NOTICE_VERSION, optedOut: false }
  try { learningInfo = { available: cfg.learning.collect === true && cfg.learning.privacyAcknowledged === true, noticeVersion: LEARNING_NOTICE_VERSION, optedOut: await learningStore.isOptedOut(ctx.uid) } } catch (e) { /* keep the default */ }
  return { enabled: cfg.enabled, luna: lunaInfo, learning: learningInfo, ...(await limits.getUsageStatus(ctx.uid, cfg)), maxInputChars: cfg.limits.maxInputChars, retentionDays: cfg.retention.days,
    languages: Object.fromEntries(Object.entries(cfg.languages).filter(([, v]) => v.enabled).map(([k, v]) => [k, { verified: v.verified }])) }
}
// Record or withdraw the user's acknowledgement of the AI Service Notice. Withdrawing stops Luna immediately and deletes NOTHING.
async function aiSetLunaConsent(request) {
  const ctx = await verified(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["action", "noticeVersion"])
  if (d.action !== "accept" && d.action !== "withdraw") throw new HttpsError("invalid-argument", "invalid-action")
  if (d.action === "accept" && d.noticeVersion !== NOTICE_VERSION) throw new HttpsError("invalid-argument", "notice-version-mismatch", { current: NOTICE_VERSION })
  return { consent: await consent.setConsent(ctx.uid, d.action) }
}
async function aiListConversations(request) {
  const ctx = await verified(request)
  V.object(request.data ?? {})
  return { conversations: await conv.listConversations(ctx.uid, 30) }
}
async function aiGetConversation(request) {
  const ctx = await verified(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["conversationId"])
  const c = await conv.getConversation(ctx.uid, cidOf(d.conversationId), 100)
  // Cards are rebuilt from the CURRENT database record, so a listing suspended since the answer shows as unavailable.
  const cfg = await cfgMod.getAiConfig()
  const messages = []
  for (const m of c.messages) {
    const cards = m.role === "assistant" ? await hydrateRefs((m.cardRefs || []).map((x) => x.ref), { cfg, now: clock.now(), location: null }) : []
    const { cardRefs, bookingOfferRefs, intent, ownerUid, expireAt, requestId, conversationId, createdAt, ...rest } = m
    messages.push({ ...rest, createdAt: createdAt && createdAt.toMillis ? createdAt.toMillis() : null, ...(m.role === "assistant" ? { cards } : {}) })
  }
  return { conversation: c.conversation, messages }
}
async function aiDeleteConversation(request) {
  const ctx = await verified(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["conversationId"])
  await conv.deleteConversation(ctx.uid, cidOf(d.conversationId))
  return { deleted: true }
}
// Deletes ALL conversation history. Keeps the learning opt-out, the Luna notice choice and the usage counters (see ai/erasure.js).
async function aiDeleteAllMyAiData(request) {
  const ctx = await verified(request)
  const r = await conv.deleteAllForUser(ctx.uid)
  return { deleted: true, conversations: r.conversations }
}
// Erases the user's AI data (history, Luna notice record, learning bookkeeping, any personal memory). Needs an explicit confirmation string.
// The learning opt-out is KEPT unless `releaseOptOut: true`, so erasing never silently re-enrols someone. Usage and financial counters are kept.
async function aiEraseMyAiData(request) {
  const ctx = await verified(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["confirm", "releaseOptOut"])
  if (d.confirm !== "ERASE-MY-AI-DATA") throw new HttpsError("invalid-argument", "confirmation-required")
  if (d.releaseOptOut !== undefined && typeof d.releaseOptOut !== "boolean") throw new HttpsError("invalid-argument", "invalid-releaseOptOut")
  const r = await erasure.eraseAiAccountData(ctx.uid, { accountClosed: false })
  if (d.releaseOptOut === true) await learningStore.setOptOut(ctx.uid, false)
  return { erased: true, conversations: r.conversations, retained: ["daily usage counters", "learning opt-out (unless released)"] }
}

// ---- Super Admin ------------------------------------------------------------------------------------------------------------
async function aiAdminGetUsage(request) {
  await G.requireActiveSuperAdmin(request)
  const cfg = await cfgMod.getAiConfig()
  // Numbers only. The Luna block shows the settings, the breaker state and today's global token use (never any text or user data).
  let luna = { enabled: cfg.luna.enabled }
  try { const b = await lunaBreaker.peek(); luna = { ...cfg.luna, breaker: { ...cfg.luna.breaker, state: b ? b.state : "unreadable", blockedKind: b ? b.blockedKind || null : null }, today: await lunaUsage.globalToday() } } catch (e) { /* keep the short form */ }
  return { config: { enabled: cfg.enabled, limits: cfg.limits, retention: cfg.retention, languages: cfg.languages, cache: cfg.cache, retrieval: cfg.retrieval, learning: cfg.learning, luna } }
}
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
async function aiAdminUpdateConfig(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["patch"])
  const patch = V.object(d.patch)
  const keys = Object.keys(patch)
  if (!keys.length || keys.some((k) => !cfgMod.EDITABLE.includes(k))) throw new HttpsError("invalid-argument", "uneditable-setting")
  const ref = fb.db().collection(AI_COL.config).doc("default")
  const cur = (await ref.get()).data() || {}
  const picked = Object.fromEntries(Object.entries(cur).filter(([k]) => cfgMod.EDITABLE.includes(k)))
  const next = cfgMod.merge(cfgMod.merge(cfgMod.DEFAULTS, picked), patch)
  const problems = cfgMod.validateConfig(next)
  if (problems.length) throw new HttpsError("invalid-argument", "invalid-config", { problems: problems.slice(0, 8) })
  const b = fb.db().batch()
  b.set(ref, { ...cfgMod.merge(picked, patch), updatedAt: fb.FieldValue().serverTimestamp(), updatedBy: actor.uid })
  // Learning switches and caps are booleans/numbers, so their new values are recorded; nothing else in the patch is copied into the audit log.
  const lp = isPlain(patch.learning) ? Object.fromEntries(Object.entries(patch.learning).filter(([, v]) => ["boolean", "number"].includes(typeof v))) : undefined
  writeAudit(b, { action: "ai.config.update", actorUid: actor.uid, details: { keys, ...(lp ? { learning: lp } : {}) } })
  await b.commit()
  cfgMod.invalidateConfigCache()
  return { updated: keys }
}

module.exports = { aiChat, aiSetLunaConsent, aiGetUsage, aiListConversations, aiGetConversation, aiDeleteConversation, aiDeleteAllMyAiData, aiEraseMyAiData, aiAdminGetUsage, aiAdminUpdateConfig }
