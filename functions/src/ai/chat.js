"use strict"
// The chat orchestrator. One user message in, one grounded answer out.
//   validate -> idempotency check -> reserve (daily/burst/budget, transactional) -> history -> bounded tool loop -> grounding
//   -> persist (idempotent) -> settle (actual cost). The reservation is ALWAYS settled, success or failure.
// Failure policy: a provider/outage failure refunds the user's daily allowance (not the burst slot); cost already incurred is
// still recorded. Messages, tool results and precise location are never logged; location is held in memory for this request only.
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const clock = require("../lib/clock")
const { getProvider } = require("./providers")
const { ProviderError, aiError } = require("./errors")
const usageSvc = require("./usage")
const conv = require("./conversations")
const { toolSchemas, executeTool, packageResult } = require("./tools/registry")
const { hydrateRefs } = require("./tools/cards")
const { validCoords } = require("./geo")
const { costMicros, estimateWorstCaseMicros, addUsage, zeroUsage } = require("./cost")
const { buildSystem, STATIC } = require("./prompt")
const { validateAnswer, NO_ANSWER } = require("./grounding")
const { detectLanguage } = require("./language")
const { sanitizeText } = require("./sanitize")
const log = require("./log")

let sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const setSleepForTests = (fn) => { sleep = fn }

const ID = /^[A-Za-z0-9_-]{8,64}$/
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const bad = (m) => new HttpsError("invalid-argument", m)

function parseInput(data, cfg) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("invalid-input")
  const extra = Object.keys(data).filter((k) => !["message", "conversationId", "requestId", "location"].includes(k))
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
  return { message, requestId: data.requestId, conversationId, location }
}

const chooseTier = (message, cfg) => {
  const m = message.toLowerCase()
  return cfg.planningKeywords.some((k) => m.includes(k.toLowerCase())) ? "planning" : "routine"
}

async function callWithRetry(provider, req, cfg, deadline) {
  let attempt = 0
  for (;;) {
    const left = deadline - clock.now().getTime()
    if (left < 2000) throw new ProviderError("timeout", "deadline")
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), Math.min(cfg.loop.providerTimeoutMs, left))
    try {
      return await provider.generate({ ...req, timeoutMs: Math.min(cfg.loop.providerTimeoutMs, left), signal: ac.signal })
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("unknown", "provider failure")
      if (!pe.retryable || attempt >= cfg.loop.providerRetries) throw pe
      attempt++
      await sleep(Math.min(pe.retryAfterMs || 400, 1500))
    } finally { clearTimeout(timer) }
  }
}

async function runChat({ uid, data, cfg }) {
  if (!cfg.enabled) throw aiError("unavailable", "ai-disabled")
  const input = parseInput(data, cfg)
  const now = clock.now()
  const cid = input.conversationId || conv.deterministicConversationId(uid, input.requestId)
  const toolCtx = { cfg, now, location: input.location }

  // Idempotency: a retry of a finished request returns the stored answer and costs nothing.
  const stored = await conv.findStoredReply(uid, cid, input.requestId)
  if (stored) return storedResponse(stored, cid, toolCtx, cfg)
  if (input.conversationId && !(await conv.loadOwned(uid, cid))) throw new HttpsError("not-found", "conversation-not-found")

  const language = detectLanguage(input.message)
  const tier = chooseTier(input.message, cfg)
  const model = cfg.models[tier]
  const system = buildSystem({ now, language, hasLocation: !!input.location })
  const history = await conv.loadHistory(uid, cid, cfg)
  const estimate = estimateWorstCaseMicros({
    model, baseChars: STATIC.length + 2000 + history.reduce((n, m) => n + m.content.length, 0) + input.message.length + JSON.stringify(toolSchemas()).length,
    maxOutputTokens: cfg.maxOutputTokens[tier], iterations: cfg.loop.maxIterations, toolResultMaxChars: cfg.loop.toolResultMaxChars,
  }, cfg)

  const r = await usageSvc.reserve({ uid, requestId: input.requestId, estimateMicros: estimate, cfg })
  if (!r.ok) {
    if (r.reason === "daily") throw new HttpsError("resource-exhausted", "daily-limit", { limit: r.limit, resetsInSeconds: r.resetsInSeconds })
    if (r.reason === "burst") throw new HttpsError("resource-exhausted", "rate-limited", { retryAfterSeconds: r.retryAfterSeconds })
    if (r.reason === "in_progress") throw new HttpsError("aborted", "request-in-progress")
    throw new HttpsError("unavailable", "ai-unavailable")
  }

  let usage = zeroUsage(), toolCalls = 0, outcome = "failed", refundDaily = false, result = null
  try {
    const provider = getProvider(cfg.provider)
    const deadline = now.getTime() + cfg.loop.totalDeadlineMs
    const evidence = new Map(), bookable = new Set()
    let hasDistance = false
    const messages = [...history, { role: "user", content: input.message }]
    let finalResp = null
    for (let i = 0; i < cfg.loop.maxIterations; i++) {
      const last = i === cfg.loop.maxIterations - 1
      const resp = await callWithRetry(provider, {
        model, system, messages, tools: last ? [] : toolSchemas(), maxTokens: cfg.maxOutputTokens[tier], effort: cfg.effort[tier],
      }, cfg, deadline)
      usage = addUsage(usage, resp.usage)
      if (!resp.toolCalls.length || last || resp.stopReason !== "tool_use") { finalResp = resp; break }
      messages.push(resp.assistantMessage)
      const results = []
      for (const call of resp.toolCalls) {
        if (toolCalls >= cfg.loop.maxToolCalls) { results.push({ toolUseId: call.id, content: JSON.stringify({ error: "tool_limit_reached", note: "Answer with what you have." }), isError: true }); continue }
        toolCalls++
        const res = await executeTool(call.name, call.input, toolCtx) // never throws; returns {ok:false,error} on any failure
        if (res.ok) {
          for (const e of res.evidence || []) { if (e && typeof e.ref === "string") evidence.set(e.ref, e); if (e && e.approxKm != null) hasDistance = true }
          if (call.name === "checkBookable" && res.data && res.data.bookable === true && call.input) bookable.add(`listing:${call.input.collection}/${call.input.id}`)
        }
        results.push({ toolUseId: call.id, content: packageResult(res, cfg), isError: !res.ok })
      }
      messages.push({ role: "user", toolResults: results })
    }
    if (finalResp.stopReason === "refusal") finalResp = { ...finalResp, text: JSON.stringify({ language, blocks: [{ type: "unverified", text: NO_ANSWER }] }) }
    const v = validateAnswer(finalResp.text, { evidence, cfg, bookable, detectedLanguage: language, hasDistance })
    const cards = await hydrateRefs(v.cards, toolCtx)
    const offers = cards.filter((c) => v.bookingOffers.includes(c.ref) && !c.unavailable).map((c) => ({ ref: c.ref, title: c.title }))
    const assistant = {
      blocks: v.blocks, cardRefs: cards.filter((c) => !c.unavailable).map((c) => ({ ref: c.ref, name: c.title })), followUps: v.followUps,
      bookingOfferRefs: offers.map((o) => o.ref), language: v.language, model: finalResp.model || model, distanceNote: v.distanceNote,
    }
    const saved = await conv.persistTurn({ uid, cid, requestId: input.requestId, userText: sanitizeText(input.message, cfg.limits.maxInputChars), assistant, cfg })
    result = { conversationId: cid, messageId: saved.id, ...responseShape(assistant, cards, offers, cfg), duplicate: saved.duplicate === true }
    outcome = "ok"
    log.info("ai.chat.ok", { uidHash: log.uidHash(uid), model: assistant.model, tier, toolCalls, stripped: v.report.strippedSentences, downgraded: v.report.downgradedBlocks, language: v.language })
  } catch (e) {
    const pe = e instanceof ProviderError ? e : null
    refundDaily = !!pe // outage, timeout, overload: the user must not lose a message for it
    log.warn("ai.chat.failed", { uidHash: log.uidHash(uid), model, kind: pe ? pe.kind : "internal", code: e && e.code })
    if (pe) throw new HttpsError("unavailable", pe.kind === "rate_limited" || pe.kind === "overloaded" ? "ai-busy" : "ai-provider-unavailable")
    throw e instanceof HttpsError ? e : new HttpsError("internal", "ai-failed")
  } finally {
    try {
      await usageSvc.settle({ uid, requestId: input.requestId, estimateMicros: estimate, costMicros: costMicros(model, usage, cfg), usage, toolCalls, outcome, refundDaily, cfg })
    } catch (se) { log.error("ai.settle.failed", { uidHash: log.uidHash(uid), code: se && se.code }) }
  }
  const status = await usageSvc.getUsageStatus(uid, cfg)
  return { ...result, usage: { dailyLimit: status.dailyLimit, remainingToday: status.remainingToday } }
}

function responseShape(assistant, cards, offers, cfg) {
  const lang = assistant.language
  const unverified = !!(cfg.languages[lang] && cfg.languages[lang].verified === false)
  return {
    language: lang, languageVerified: !unverified,
    ...(unverified ? { languageNotice: "isiZulu support is still being tested, so some answers may contain mistakes." } : {}),
    blocks: assistant.blocks, cards, bookingOffers: offers, followUps: assistant.followUps, distanceNote: assistant.distanceNote || null,
    bookingNote: offers.length ? "Booking is a request only: the provider accepts or declines it, and nothing is confirmed until they respond." : null,
  }
}
async function storedResponse(stored, cid, toolCtx, cfg) {
  const cards = await hydrateRefs((stored.cardRefs || []).map((c) => c.ref), toolCtx)
  const offers = cards.filter((c) => (stored.bookingOfferRefs || []).includes(c.ref) && !c.unavailable).map((c) => ({ ref: c.ref, title: c.title }))
  const status = await usageSvc.getUsageStatus(stored.ownerUid, cfg)
  return { conversationId: cid, messageId: stored.id, ...responseShape(stored, cards, offers, cfg), duplicate: true, usage: { dailyLimit: status.dailyLimit, remainingToday: status.remainingToday } }
}

module.exports = { runChat, parseInput, chooseTier, setSleepForTests, responseShape }
