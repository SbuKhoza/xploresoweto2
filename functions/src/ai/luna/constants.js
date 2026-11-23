"use strict"
// Fixed Luna constants. Nothing here is user-editable and nothing here is a secret.
// Luna is a WORDING layer only: it may rephrase a few server-designated, fact-free conversational phrases. Malloya's deterministic
// engine stays the sole source of facts, retrieval, safety, cards, follow-ups, itineraries, limits, idempotency and persistence.
const MODEL = "gpt-6-luna" // fixed in code: not configurable at runtime
const ENDPOINT = "https://api.openai.com/v1/responses"
const NOTICE_VERSION = 1 // bump when the AI Service Notice wording changes: consent then has to be given again
const GLOBAL_SHARDS = 8 // global token budget is spread over this many documents so no single document becomes a hot spot
const REQUEST_RECORD_TTL_DAYS = 3
const BYTE_CEILING = 6000 // SECONDARY guard on the request body size. It is NOT proof of a token limit (see calibration.json)

// Failure kinds the provider layer reports. Each is classified for the breaker and for budget accounting.
//   release  : the provider rejected the call before doing any work, so the reserved tokens are given back
//   charge   : the provider may have processed the call (timeout, 5xx, dropped connection): the reservation stays charged (conservative)
const KINDS = Object.freeze({
  rate_limit: { breaker: "open", charge: false },
  billing: { breaker: "blocked", charge: false }, // insufficient_quota / spend limit: configuration problem, needs an operator
  auth: { breaker: "blocked", charge: false }, // 401/403: bad or missing key
  bad_request: { breaker: "count", charge: false },
  server: { breaker: "count", charge: true },
  timeout: { breaker: "count", charge: true },
  network: { breaker: "count", charge: true },
  invalid_response: { breaker: "count", charge: true }, // 200 but unusable: usage (if present) is charged
  incomplete: { breaker: "count", charge: true },
})
// Documented OpenAI codes that mean "billing / quota", not "slow down" (error codes guide). A 429 is only a rate limit when none of these match.
const BILLING_CODES = Object.freeze(["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"])

// Hard ceilings that no stored configuration can exceed, whatever a Super Admin writes.
const CEILINGS = Object.freeze({ dailySuccessPerUser: 20, dailyAttemptsPerUser: 50, maxInputTokens: 3000, maxOutputTokens: 500, dailyGlobalTokens: 3000000, maxConcurrentPerInstance: 4, recoveryConcurrent: 4, timeoutMs: 15000 })

module.exports = { MODEL, ENDPOINT, NOTICE_VERSION, GLOBAL_SHARDS, REQUEST_RECORD_TTL_DAYS, BYTE_CEILING, KINDS, BILLING_CODES, CEILINGS }
