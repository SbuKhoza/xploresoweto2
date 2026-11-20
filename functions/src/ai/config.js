"use strict"
// Runtime-configurable settings for the database-powered assistant. Code defaults make an EMPTY database work; `ai-config/default`
// (server-only, Super Admin editable via aiAdminUpdateConfig) overrides them without a redeploy. Every override is bounds-checked, and an
// invalid stored document is IGNORED (defaults apply), so a bad edit can never weaken limits or crash the assistant.
// There is no model, provider, price, token or budget setting: the assistant calls no external AI service.
const fb = require("../lib/firebase")
const clock = require("../lib/clock")
const { AI_COL } = require("./constants")

const DEFAULTS = Object.freeze({
  enabled: true, // kill switch (Super Admin)
  limits: { dailyMessages: 50, burstPerMinute: 5, burstWindowSeconds: 60, maxInputChars: 1000 },
  retention: { days: 90 },
  languages: { en: { enabled: true, verified: true }, zu: { enabled: false, verified: false } }, // isiZulu: NOT implemented; detected and answered in English with a notice
  cache: { listingTtlSeconds: 300 },
  retrieval: { scanLimit: 150, maxResults: 6, queryTimeoutMs: 8000 },
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
  return p
}

const EDITABLE = Object.freeze(["enabled", "limits", "retention", "languages", "cache", "retrieval"])

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
