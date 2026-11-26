"use strict"
// The chat orchestrator. One user message in, one answer composed from XploreSoweto records out. No model, no external API.
//   validate -> idempotency -> reserve (per-user daily + burst limits) -> engine -> cards from the retrieved records -> persist -> settle
// The reservation is ALWAYS settled. An internal failure refunds the daily allowance. Messages and precise location are never logged;
// location is held in memory for this request only.
const { HttpsError } = require("firebase-functions/v2/https")
const clock = require("../lib/clock")
const { aiError } = require("./errors")
const limits = require("./ratelimit")
const conv = require("./conversations")
const { respond } = require("./engine/engine")
const { cardFromEvidence, hydrateRefs } = require("./retrieval/cards")
const { validCoords } = require("./geo")
const { sanitizeText } = require("./sanitize")
const log = require("./log")
const luna = require("./luna")
const capture = require("./learning/capture")

const ENGINE = "database-v1"
const ID = /^[A-Za-z0-9_-]{8,64}$/
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const bad = (m) => new HttpsError("invalid-argument", m)

function parseInput(data, cfg) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("invalid-input")
  const extra = Object.keys(data).filter((k) => !["message", "conversationId", "requestId", "location", "aiNoticeVersion"].includes(k))
  if (extra.length) throw bad("invalid-input")
  const message = typeof data.message === "string" ? data.message.replace(/\r\n?/g, "\n").trim() : ""
  if (!message || CONTROL.test(message)) throw bad("invalid-message")
  if (message.length > cfg.limits.maxInputChars) throw new HttpsError("invalid-argument", "message-too-long", { maxChars: cfg.limits.maxInputChars })
  if (typeof data.requestId !== "string" || !ID.test(data.requestId)) throw bad("invalid-request-id")
  let conversationId = null
  if (data.conversationId !== undefined && data.conversationId !== null) {
    if (typeof data.conversationId !== "string" || !/^c_[a-f0-9]{24}$/.test(data.conversationId)) throw bad("invalid-conversation-id")
    conversationId = data.conversationId
  }
  let location = null
  if (data.location !== undefined && data.location !== null) { // optional, transient, never stored or logged
    const l = data.location
    if (typeof l !== "object" || Array.isArray(l) || Object.keys(l).some((k) => !["latitude", "longitude"].includes(k)) || !validCoords(l)) throw bad("invalid-location")
    location = { latitude: l.latitude, longitude: l.longitude }
  }
  // Capability signal ONLY (an old app never sends it): it is not proof of consent, which is read from ai-consent on the server.
  const noticeVersion = Number.isInteger(data.aiNoticeVersion) ? data.aiNoticeVersion : null
  return { message, requestId: data.requestId, conversationId, location, noticeVersion }
}

function responseShape(assistant, cards, offers, cfg) {
  const lang = assistant.language || "en"
  return {
    language: "en", detectedLanguage: lang, engine: assistant.engine || ENGINE,
    ...(lang !== "en" ? { languageNotice: "isiZulu is not supported yet. This answer is in English." } : {}),
    blocks: assistant.blocks, cards, bookingOffers: offers, followUps: assistant.followUps, distanceNote: assistant.distanceNote || null,
    bookingNote: offers.length ? "Booking is a request only: the provider accepts or declines it, and nothing is confirmed until they respond." : null,
  }
}

async function runChat({ uid, data, cfg }) {
  if (!cfg.enabled) throw aiError("unavailable", "ai-disabled")
  const input = parseInput(data, cfg)
  const now = clock.now()
  const cid = input.conversationId || conv.deterministicConversationId(uid, input.requestId)
  const ctx = { cfg, now, location: input.location }

  // Idempotency: a retry of a finished request returns the stored answer without running the engine or using an allowance.
  const stored = await conv.findStoredReply(uid, cid, input.requestId)
  if (stored) return storedResponse(uid, stored, cid, ctx, cfg)
  const owned = input.conversationId ? await conv.loadOwned(uid, cid) : null
  if (input.conversationId && !owned) throw new HttpsError("not-found", "conversation-not-found")

  const r = await limits.reserve({ uid, requestId: input.requestId, cfg })
  if (!r.ok) {
    if (r.reason === "daily") throw new HttpsError("resource-exhausted", "daily-limit", { limit: r.limit, resetsInSeconds: r.resetsInSeconds })
    if (r.reason === "burst") throw new HttpsError("resource-exhausted", "rate-limited", { retryAfterSeconds: r.retryAfterSeconds })
    throw new HttpsError("aborted", "request-in-progress")
  }

  let outcome = "failed", refund = false, result = null
  try {
    const out = await respond({ message: input.message, context: owned ? owned.context : null, location: input.location, cfg, now })
    const seen = new Set(), cards = []
    for (const e of out.evidence) { if (e && e.ref && !seen.has(e.ref) && ["listing", "event"].includes(e.kind) && cards.length < 12) { seen.add(e.ref); cards.push(cardFromEvidence(e)) } }
    const offers = cards.filter((c) => out.bookingOffers.includes(c.ref)).map((c) => ({ ref: c.ref, title: c.title }))
    const assistant = { blocks: out.blocks, cardRefs: cards.map((c) => ({ ref: c.ref, name: c.title })), followUps: out.followUps, bookingOfferRefs: offers.map((o) => o.ref), language: out.language, engine: ENGINE, intent: typeof out.intent === "string" ? out.intent.slice(0, 30) : null, distanceNote: out.blocks.some((b) => /straight-line/i.test(b.text)) ? "Approximate straight-line distance, not driving distance or travel time." : null }
    // Optional wording layer: hands back the SAME blocks unless a server-designated, fact-free phrase was validly reworded. Never throws.
    const lr = await luna.tryRewrite({ uid, requestId: input.requestId, cfg, intent: out.intent, blocks: out.blocks, language: out.language, noticeVersion: input.noticeVersion })
    assistant.blocks = lr.blocks
    const saved = await conv.persistTurn({ uid, cid, requestId: input.requestId, userText: sanitizeText(input.message, cfg.limits.maxInputChars), assistant, context: out.context, cfg, luna: lr.commit })
    if (Array.isArray(saved.blocks)) assistant.blocks = saved.blocks // what was actually stored (consent may have been withdrawn mid-call; a duplicate returns the first answer)
    result = { conversationId: cid, messageId: saved.id, ...responseShape(assistant, cards, offers, cfg), duplicate: saved.duplicate === true }
    outcome = "ok"
    await capture.fromTurn({ uid, message: input.message, signals: out.signals, cfg, requestId: input.requestId }) // best effort, never throws, off unless a Super Admin enabled it
    log.info("ai.chat.ok", { uidHash: log.uidHash(uid), intent: out.intent, language: out.language, cards: cards.length })
  } catch (e) {
    refund = !(e instanceof HttpsError) // an internal failure must not cost the user a message
    log.warn("ai.chat.failed", { uidHash: log.uidHash(uid), kind: "internal", code: e && e.code })
    throw e instanceof HttpsError ? e : new HttpsError("internal", "ai-failed")
  } finally {
    try { await limits.settle({ uid, requestId: input.requestId, outcome, refund }) } catch (se) { log.error("ai.settle.failed", { uidHash: log.uidHash(uid), code: se && se.code }) }
  }
  const status = await limits.getUsageStatus(uid, cfg)
  return { ...result, usage: { dailyLimit: status.dailyLimit, remainingToday: status.remainingToday } }
}

async function storedResponse(uid, stored, cid, ctx, cfg) {
  const cards = await hydrateRefs((stored.cardRefs || []).map((c) => c.ref), ctx) // rebuilt from the CURRENT records
  const offers = cards.filter((c) => (stored.bookingOfferRefs || []).includes(c.ref) && !c.unavailable).map((c) => ({ ref: c.ref, title: c.title }))
  const status = await limits.getUsageStatus(uid, cfg)
  return { conversationId: cid, messageId: stored.id, ...responseShape(stored, cards, offers, cfg), duplicate: true, usage: { dailyLimit: status.dailyLimit, remainingToday: status.remainingToday } }
}
module.exports = { runChat, parseInput, responseShape }
