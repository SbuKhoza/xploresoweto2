"use strict"
// Luna wording layer. tryRewrite() NEVER throws and NEVER blocks a valid request: on any doubt, failure, limit or refusal it hands back the
// original deterministic blocks. The checks run cheapest-first and every one of them can only turn Luna OFF for this request:
//   feature on -> client supports the notice -> block is an exact known template -> payload calibrated -> key present -> consent recorded
//   -> user's allowance -> per-instance concurrency -> breaker (global probe/recovery) -> durable "called" commit + budget reservation -> provider call
//   -> strict validation -> (success) usage committed inside the conversation transaction (see conversations.persistTurn)
const consent = require("../consent")
const log = require("../log")
const provider = require("./provider")
const prompt = require("./prompt")
const { validateRewrite } = require("./validate")
const usage = require("./usage")
const breaker = require("./breaker")
const { NOTICE_VERSION, effectiveCfg } = require("./constants")
const manifest = require("./calibration.json")

let deps = { callResponses: provider.callResponses, hasKey: provider.hasKey, manifest }
const setDepsForTests = (d) => { breaker.resetLocalForTests(); deps = { callResponses: provider.callResponses, hasKey: provider.hasKey, manifest, ...d } }
let inflight = 0 // per-INSTANCE concurrency. Global ceiling = this limit x the deployed maxInstances of aiChat (verify at deploy time).
const inflightNow = () => inflight

// -> { maxTokens } when this payload is inside the calibrated universe, else null (Luna skipped).
function calibrated(payload, cfg) {
  const m = deps.manifest, e = m && m.payloads && m.payloads[payload.id]
  if (!m || m.status !== "calibrated" || !["none", "low"].includes(m.reasoningEffort) || !e || e.sha256 !== payload.sha256) return null
  if (!Number.isInteger(e.inputTokens) || e.inputTokens <= 0 || e.inputTokens > cfg.luna.limits.maxInputTokens || !payload.withinByteCeiling) return null
  return { inputTokens: e.inputTokens, reasoningEffort: m.reasoningEffort }
}

async function tryRewrite({ uid, requestId, cfg, intent, blocks, language, noticeVersion }) {
  const original = { blocks, commit: null, applied: false }
  cfg = effectiveCfg(cfg) // every limit clamped to its hard ceiling, whatever is stored
  const skip = (reason) => ({ ...original, skipped: reason })
  try {
    const L = cfg.luna
    if (!L || L.enabled !== true) return skip("disabled")
    if (noticeVersion !== NOTICE_VERSION) return skip("client-without-notice")
    const tpl = prompt.matchTemplate(intent, blocks, language)
    if (!tpl) return skip("not-rewritable")
    const payload = prompt.buildPayload(tpl.intent, language)
    const cal = payload && calibrated(payload, cfg)
    if (!cal) return skip("uncalibrated")
    if (!deps.hasKey()) return skip("no-key")
    if (!(await consent.getConsent(uid)).active) return skip("no-consent")
    const status = await usage.userStatus(uid, cfg)
    if (status.remainingToday <= 0) return skip("daily-allowance")
    if (inflight >= L.limits.maxConcurrentPerInstance) return skip("busy")
    inflight += 1
    const owner = breaker.ownerKey(uid, requestId)
    try {
      const gate = await breaker.admit({ owner, cfg })
      if (!gate.allowed) return skip(`breaker:${gate.reason}`)
      const reserve = cal.inputTokens + L.limits.maxOutputTokens // the most this call can possibly cost
      const ticket = await usage.begin({ uid, requestId, cfg, reserveTokens: reserve }) // durable "called" commit BEFORE the network request
      if (!ticket.ok) { await breaker.release({ owner, mode: gate.mode }); return skip(`usage:${ticket.reason}`) }
      const res = await deps.callResponses({ payload, maxOutputTokens: L.limits.maxOutputTokens, reasoningEffort: cal.reasoningEffort, timeoutMs: L.limits.timeoutMs })
      if (!res.ok) {
        await breaker.report({ owner, mode: gate.mode, ok: false, kind: res.kind, retryAfterSeconds: res.retryAfterSeconds, cfg })
        await usage.settleFailure({ uid, requestId, ticket, kind: res.kind, usage: res.usage || null }).catch(() => {})
        log.warn("ai.luna.failed", { uidHash: log.uidHash(uid), kind: res.kind, latencyMs: res.ms })
        return skip(`provider:${res.kind}`)
      }
      const v = validateRewrite(tpl, res.text)
      const overrun = !!(res.usage && res.usage.input > L.limits.maxInputTokens)
      // The provider behaved (it answered), so this is a success report; rejected/overrun feed the breaker's own bookkeeping.
      await breaker.report({ owner, mode: gate.mode, ok: true, rejected: !v.ok, overrun, cfg })
      if (overrun) log.error("ai.luna.calibration_drift", { uidHash: log.uidHash(uid), kind: "input-over-limit" })
      if (!v.ok) {
        await usage.settleFailure({ uid, requestId, ticket, kind: "rejected", usage: res.usage }).catch(() => {})
        log.warn("ai.luna.rejected", { uidHash: log.uidHash(uid), kind: v.reason })
        return skip(`rejected:${v.reason}`)
      }
      const text = prompt.joinSegments(tpl, v.segments)
      return { blocks: [{ ...blocks[0], text }], commit: usage.prepareSuccess({ uid, requestId, ticket, usage: res.usage, originalBlocks: blocks }), applied: true }
    } finally { inflight -= 1 }
  } catch (e) {
    log.error("ai.luna.error", { uidHash: log.uidHash(uid), kind: "internal", code: e && e.code })
    return skip("error")
  }
}
module.exports = { tryRewrite, setDepsForTests, calibrated, inflightNow }
