"use strict"
// Runtime-configurable AI settings. Code defaults make an EMPTY database work; `ai-config/default` (server-only, Super Admin
// editable via aiAdminUpdateConfig) overrides them without a redeploy. Every override is bounds-checked, and an invalid stored
// document is IGNORED (defaults apply) so a bad edit can never weaken limits or crash the assistant.
const fb = require("../lib/firebase")
const clock = require("../lib/clock")
const { AI_COL } = require("./constants")

const PRICING_VERIFIED = {
  verifiedAt: "2026-11-18",
  sources: ["https://platform.claude.com/docs/en/models/haiku-5-5/overview", "https://platform.claude.com/docs/en/models/sonnet-5-5/overview"],
}
const DEFAULTS = Object.freeze({
  enabled: true,
  provider: "anthropic",
  models: { routine: "claude-haiku-5-5", planning: "claude-sonnet-5-5" }, // verified 2026-11-18 (docs/stage2/VERIFICATION_RECORD.md)
  effort: { routine: "low", planning: "medium" },
  maxOutputTokens: { routine: 2000, planning: 4500 }, // thinking counts toward max_tokens, so leave headroom
  limits: { dailyMessages: 10, burstPerMinute: 3, burstWindowSeconds: 60, maxInputChars: 1000, maxHistoryMessages: 12, maxHistoryChars: 6000 },
  loop: { maxIterations: 5, maxToolCalls: 8, toolTimeoutMs: 8000, providerTimeoutMs: 45000, totalDeadlineMs: 70000, providerRetries: 1, toolResultMaxChars: 6000 },
  budget: { monthlyUsd: 50, warnFractions: [0.5, 0.8], tripFraction: 1.0, inflightStaleSeconds: 300 },
  retention: { days: 90 },
  languages: { en: { enabled: true, verified: true }, zu: { enabled: true, verified: false } },
  planningKeywords: ["itinerary", "plan my", "plan a", "plan our", "multi-day", "day in soweto", "days in soweto", "schedule", "budget", "hlela", "uhlelo", "isabelomali", "izinsuku"],
  strictEntityMentions: true,
  cache: { listingTtlSeconds: 60 },
  pricing: {
    ...PRICING_VERIFIED,
    models: {
      "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheWritePerMTok: 0.125, cacheReadPerMTok: 0.01, long: { thresholdTokens: 100000, inputPerMTok: 0.5, outputPerMTok: 2.5, cacheWritePerMTok: 0.625, cacheReadPerMTok: 0.05 } },
      "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.1 },
    },
    fallback: { inputPerMTok: 8, outputPerMTok: 40, cacheWritePerMTok: 10, cacheReadPerMTok: 0.8 }, // deliberately conservative for unknown models
  },
})

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const merge = (base, over) => {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v
  return out
}
const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const EFFORTS = ["low", "medium", "high", "xhigh", "max"]
const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,59}$/

// Returns a list of problems (empty = valid). Used for stored config and for admin updates.
function validateConfig(c) {
  const p = []
  const need = (ok, msg) => { if (!ok) p.push(msg) }
  need(typeof c.enabled === "boolean", "enabled")
  need(c.provider === "anthropic", "provider")
  for (const k of ["routine", "planning"]) {
    need(typeof c.models?.[k] === "string" && MODEL_ID.test(c.models[k]), `models.${k}`)
    need(EFFORTS.includes(c.effort?.[k]), `effort.${k}`)
    need(int(c.maxOutputTokens?.[k], 200, 16000), `maxOutputTokens.${k}`)
  }
  const L = c.limits || {}
  need(int(L.dailyMessages, 1, 1000), "limits.dailyMessages"); need(int(L.burstPerMinute, 1, 60), "limits.burstPerMinute")
  need(int(L.burstWindowSeconds, 10, 3600), "limits.burstWindowSeconds"); need(int(L.maxInputChars, 50, 4000), "limits.maxInputChars")
  need(int(L.maxHistoryMessages, 0, 40), "limits.maxHistoryMessages"); need(int(L.maxHistoryChars, 0, 20000), "limits.maxHistoryChars")
  const O = c.loop || {}
  need(int(O.maxIterations, 1, 8), "loop.maxIterations"); need(int(O.maxToolCalls, 1, 20), "loop.maxToolCalls")
  need(int(O.toolTimeoutMs, 500, 30000), "loop.toolTimeoutMs"); need(int(O.providerTimeoutMs, 3000, 100000), "loop.providerTimeoutMs")
  need(int(O.totalDeadlineMs, 5000, 80000), "loop.totalDeadlineMs"); need(int(O.providerRetries, 0, 3), "loop.providerRetries")
  need(int(O.toolResultMaxChars, 500, 20000), "loop.toolResultMaxChars")
  const B = c.budget || {}
  need(num(B.monthlyUsd, 1, 1000000), "budget.monthlyUsd"); need(num(B.tripFraction, 0.1, 1.5), "budget.tripFraction")
  need(Array.isArray(B.warnFractions) && B.warnFractions.length <= 5 && B.warnFractions.every((f) => num(f, 0.05, 1.5)), "budget.warnFractions")
  need(int(B.inflightStaleSeconds, 30, 3600), "budget.inflightStaleSeconds")
  need(int(c.retention?.days, 1, 365), "retention.days")
  need(isObj(c.languages) && Object.entries(c.languages).every(([k, v]) => /^[a-z]{2,3}$/.test(k) && typeof v?.enabled === "boolean" && typeof v?.verified === "boolean"), "languages")
  need(Array.isArray(c.planningKeywords) && c.planningKeywords.length <= 50 && c.planningKeywords.every((k) => typeof k === "string" && k.length >= 2 && k.length <= 40), "planningKeywords")
  need(typeof c.strictEntityMentions === "boolean", "strictEntityMentions")
  need(int(c.cache?.listingTtlSeconds, 0, 3600), "cache.listingTtlSeconds")
  const M = c.pricing?.models
  need(isObj(M) && Object.values(M).every((m) => ["inputPerMTok", "outputPerMTok", "cacheWritePerMTok", "cacheReadPerMTok"].every((k) => num(m?.[k], 0, 1000))), "pricing.models")
  need(["inputPerMTok", "outputPerMTok", "cacheWritePerMTok", "cacheReadPerMTok"].every((k) => num(c.pricing?.fallback?.[k], 0, 1000)), "pricing.fallback")
  return p
}

// Keys an admin may change at runtime. (`provider` is fixed until a second provider adapter exists.)
const EDITABLE = Object.freeze(["enabled", "models", "effort", "maxOutputTokens", "limits", "loop", "budget", "retention", "languages", "planningKeywords", "strictEntityMentions", "cache", "pricing"])

let cache = { at: 0, value: null }
let ttlMs = 60000
const invalidateConfigCache = () => { cache = { at: 0, value: null } }
const setConfigCacheTtlForTests = (ms) => { ttlMs = ms; invalidateConfigCache() }

async function getAiConfig() {
  const now = clock.now().getTime()
  if (cache.value && now - cache.at < ttlMs) return cache.value
  let value = DEFAULTS
  try {
    const snap = await fb.db().collection(AI_COL.config).doc("default").get()
    if (snap.exists) {
      const raw = snap.data() || {}
      const picked = Object.fromEntries(Object.entries(raw).filter(([k]) => EDITABLE.includes(k)))
      const merged = merge(DEFAULTS, picked)
      const problems = validateConfig(merged)
      if (problems.length === 0) value = merged
      else require("./log").error("ai.config.invalid_ignored", { problems: problems.slice(0, 8) })
    }
  } catch (e) {
    require("./log").error("ai.config.read_failed", { code: e && e.code })
  }
  cache = { at: now, value }
  return value
}

module.exports = { DEFAULTS, EDITABLE, merge, validateConfig, getAiConfig, invalidateConfigCache, setConfigCacheTtlForTests }
