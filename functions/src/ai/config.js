"use strict"
// Runtime-configurable settings for the database-powered assistant. Code defaults make an EMPTY database work; `ai-config/default`
// (server-only, Super Admin editable via aiAdminUpdateConfig) overrides them without a redeploy. Every override is bounds-checked, and an
// invalid stored document is IGNORED (defaults apply), so a bad edit can never weaken limits or crash the assistant.
// `luna` is the optional wording layer (see docs/stage2/LUNA_PHASE1.md). It is OFF by default, has no model/provider/key setting
// (those are fixed in code / Secret Manager) and every number is capped by CEILINGS below, whatever a stored document says.
const fb = require("../lib/firebase")
const clock = require("../lib/clock")
const { AI_COL } = require("./constants")

const { CEILINGS, LEASE_MARGIN_MS } = require("./luna/constants")

const DEFAULTS = Object.freeze({
  enabled: true, // kill switch (Super Admin)
  limits: { dailyMessages: 50, burstPerMinute: 5, burstWindowSeconds: 60, maxInputChars: 1000 },
  retention: { days: 90 },
  languages: { en: { enabled: true, verified: true }, zu: { enabled: false, verified: false } }, // isiZulu: NOT implemented; detected and answered in English with a notice
  cache: { listingTtlSeconds: 300 },
  retrieval: { scanLimit: 150, maxResults: 6, queryTimeoutMs: 8000 },
  luna: {
    enabled: false, // kill switch: OFF until the privacy notice, privacy policy and POPIA review are settled and a Super Admin turns it on
    resetEpoch: 0, // bump to clear a "blocked" breaker (billing/quota/key problem) after the operator has fixed it
    limits: { dailySuccessPerUser: 10, dailyAttemptsPerUser: 25, maxInputTokens: 3000, maxOutputTokens: 500, dailyGlobalTokens: 1500000, maxConcurrentPerInstance: 2, recoveryConcurrent: 2, timeoutMs: 8000 },
    breaker: { failureThreshold: 5, windowSeconds: 60, cooldownSeconds: 60, recoverySeconds: 60, leaseSeconds: 30 },
  },
})

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const merge = (base, over) => {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v
  return out
}
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

function validateConfig(c) {
  const p = []
  const need = (ok, msg) => { if (!ok) p.push(msg) }
  need(typeof c.enabled === "boolean", "enabled")
  const L = c.limits || {}
  need(int(L.dailyMessages, 1, 1000), "limits.dailyMessages"); need(int(L.burstPerMinute, 1, 60), "limits.burstPerMinute")
  need(int(L.burstWindowSeconds, 10, 3600), "limits.burstWindowSeconds"); need(int(L.maxInputChars, 50, 4000), "limits.maxInputChars")
  need(int(c.retention?.days, 1, 365), "retention.days")
  need(isObj(c.languages) && Object.entries(c.languages).every(([k, v]) => /^[a-z]{2,3}$/.test(k) && typeof v?.enabled === "boolean" && typeof v?.verified === "boolean"), "languages")
  need(int(c.cache?.listingTtlSeconds, 0, 3600), "cache.listingTtlSeconds")
  need(int(c.retrieval?.scanLimit, 20, 500), "retrieval.scanLimit"); need(int(c.retrieval?.maxResults, 1, 10), "retrieval.maxResults"); need(int(c.retrieval?.queryTimeoutMs, 500, 30000), "retrieval.queryTimeoutMs")
  const N = c.luna || {}, NL = N.limits || {}, NB = N.breaker || {}
  const only = (o, keys, name) => need(isObj(o) && Object.keys(o).every((k) => keys.includes(k)), `${name}.unknown-key`) // no model/provider/key/price settings can be smuggled in
  only(N, ["enabled", "resetEpoch", "limits", "breaker"], "luna"); only(NL, ["dailySuccessPerUser", "dailyAttemptsPerUser", "maxInputTokens", "maxOutputTokens", "dailyGlobalTokens", "maxConcurrentPerInstance", "recoveryConcurrent", "timeoutMs"], "luna.limits")
  only(NB, ["failureThreshold", "windowSeconds", "cooldownSeconds", "recoverySeconds", "leaseSeconds"], "luna.breaker")
  need(typeof N.enabled === "boolean", "luna.enabled"); need(int(N.resetEpoch, 0, 1000000), "luna.resetEpoch")
  need(int(NL.dailySuccessPerUser, 1, CEILINGS.dailySuccessPerUser), "luna.limits.dailySuccessPerUser"); need(int(NL.dailyAttemptsPerUser, 1, CEILINGS.dailyAttemptsPerUser), "luna.limits.dailyAttemptsPerUser")
  need(int(NL.maxInputTokens, 100, CEILINGS.maxInputTokens), "luna.limits.maxInputTokens"); need(int(NL.maxOutputTokens, 20, CEILINGS.maxOutputTokens), "luna.limits.maxOutputTokens")
  need(int(NL.dailyGlobalTokens, 10000, CEILINGS.dailyGlobalTokens), "luna.limits.dailyGlobalTokens"); need(int(NL.maxConcurrentPerInstance, 1, CEILINGS.maxConcurrentPerInstance), "luna.limits.maxConcurrentPerInstance")
  need(int(NL.recoveryConcurrent, 1, CEILINGS.recoveryConcurrent), "luna.limits.recoveryConcurrent"); need(int(NL.timeoutMs, 1000, CEILINGS.timeoutMs), "luna.limits.timeoutMs")
  need(Number.isInteger(NL.dailyAttemptsPerUser) && Number.isInteger(NL.dailySuccessPerUser) && NL.dailyAttemptsPerUser >= NL.dailySuccessPerUser, "luna.limits.attempts>=successes")
  need(int(NB.failureThreshold, 1, 50), "luna.breaker.failureThreshold"); need(int(NB.windowSeconds, 5, 600), "luna.breaker.windowSeconds"); need(int(NB.cooldownSeconds, 5, 900), "luna.breaker.cooldownSeconds")
  need(int(NB.recoverySeconds, 5, 600), "luna.breaker.recoverySeconds"); need(int(NB.leaseSeconds, 10, 120), "luna.breaker.leaseSeconds")
  need(Number.isInteger(NL.timeoutMs) && Number.isInteger(NB.leaseSeconds) && NL.timeoutMs + LEASE_MARGIN_MS <= NB.leaseSeconds * 1000, "luna.breaker.lease>timeout")
  return p
}

const EDITABLE = Object.freeze(["enabled", "limits", "retention", "languages", "cache", "retrieval", "luna"])

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
      const picked = Object.fromEntries(Object.entries(snap.data() || {}).filter(([k]) => EDITABLE.includes(k)))
      const merged = merge(DEFAULTS, picked)
      const problems = validateConfig(merged)
      if (problems.length === 0) value = merged
      else require("./log").error("ai.config.invalid_ignored", { problems: problems.slice(0, 8) })
    }
  } catch (e) { require("./log").error("ai.config.read_failed", { code: e && e.code }) }
  cache = { at: now, value }
  return value
}
module.exports = { DEFAULTS, EDITABLE, merge, validateConfig, getAiConfig, invalidateConfigCache, setConfigCacheTtlForTests }
