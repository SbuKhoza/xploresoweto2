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
const { AI_COL } = require("../ai/constants")
const cfgMod = require("../ai/config")
const usageSvc = require("../ai/usage")
const conv = require("../ai/conversations")
const { runChat } = require("../ai/chat")
const { hydrateRefs } = require("../ai/tools/cards")
const log = require("../ai/log")

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
  return { enabled: cfg.enabled, ...(await usageSvc.getUsageStatus(ctx.uid, cfg)), maxInputChars: cfg.limits.maxInputChars, retentionDays: cfg.retention.days,
    languages: Object.fromEntries(Object.entries(cfg.languages).filter(([, v]) => v.enabled).map(([k, v]) => [k, { verified: v.verified }])) }
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
    const { cardRefs, bookingOfferRefs, ownerUid, expireAt, requestId, conversationId, createdAt, ...rest } = m
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
async function aiDeleteAllMyAiData(request) {
  const ctx = await verified(request)
  const r = await conv.deleteAllForUser(ctx.uid)
  return { deleted: true, conversations: r.conversations }
}

// ---- Super Admin ------------------------------------------------------------------------------------------------------------
async function aiAdminGetUsage(request) {
  await G.requireActiveSuperAdmin(request)
  const cfg = await cfgMod.getAiConfig()
  return { summary: await usageSvc.getGlobalSummary(cfg), config: { enabled: cfg.enabled, models: cfg.models, limits: cfg.limits, budget: cfg.budget, retention: cfg.retention, languages: cfg.languages } }
}
async function aiAdminSetBreaker(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["action"])
  const action = V.oneOf(d.action, "action", ["trip", "reset"])
  const r = await usageSvc.setBreaker({ action })
  const b = fb.db().batch()
  writeAudit(b, { action: `ai.circuit_breaker.${action}`, actorUid: actor.uid, details: { was: r.was, now: r.now } })
  await b.commit()
  log.warn("ai.breaker.admin", { code: action })
  return r
}
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
  writeAudit(b, { action: "ai.config.update", actorUid: actor.uid, details: { keys } })
  await b.commit()
  cfgMod.invalidateConfigCache()
  return { updated: keys }
}

module.exports = { aiChat, aiGetUsage, aiListConversations, aiGetConversation, aiDeleteConversation, aiDeleteAllMyAiData, aiAdminGetUsage, aiAdminSetBreaker, aiAdminUpdateConfig }
