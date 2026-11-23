"use strict"
// Fixed Luna constants. Nothing here is user-editable and nothing here is a secret.
// Luna is a WORDING layer only: it may rephrase a few server-designated, fact-free conversational phrases. Malloya's deterministic
// engine stays the sole source of facts, retrieval, safety, cards, follow-ups, itineraries, limits, idempotency and persistence.
const MODEL = "gpt-6-luna" // fixed in code: not configurable at runtime
const ENDPOINT = "https://api.openai.com/v1/responses"
const NOTICE_VERSION = 1 // bump when the AI Service Notice wording changes: consent then has to be given again
const GLOBAL_SHARDS = 8 // global token budget is spread over this many documents so no single document becomes a hot spot
// luna_r_* request records ("this uid+requestId was already sent to the provider") have NO expireAt and are never deleted by any policy:
// the same requestId must never cause a second paid call, however many days later. Only the day-scoped counters (luna_u_*, luna_g_*) expire.
const BYTE_CEILING = 6000 // SECONDARY guard on the request body size. It is NOT proof of a token limit (see calibration.json)

// Failure kinds the provider layer reports. Each is classified for the breaker and for budget accounting.
//   release  : the provider rejected the call before doing any work, so the reserved tokens are given back
//   charge   : the provider may have processed the call (timeout, 5xx, dropped connection): the reservation stays charged (conservative)
const KINDS = Object.freeze({
  rate_limit: { breaker: "open", charge: false },
  billing: { breaker: "blocked", charge: false }, // insufficient_quota / spend limit: configuration problem, needs an operator
  auth: { breaker: "blocked", charge: false }, // 401/403: bad or missing key
  unreported: { breaker: "open", charge: true }, // an outcome nobody recorded (crash, lost write): the breaker opens at the current ladder step; the next probe finds the truth
  bad_request: { breaker: "blocked", charge: false }, // 400/404/405/413/415/422: our request or the configured model/endpoint is wrong. Retrying cannot help.
  server: { breaker: "count", charge: true },
  timeout: { breaker: "count", charge: true },
  network: { breaker: "count", charge: true },
  invalid_response: { breaker: "count", charge: true }, // 200 but unusable: usage (if present) is charged
  incomplete: { breaker: "count", charge: true },
})
// Documented OpenAI codes that mean "billing / quota", not "slow down" (error codes guide). A 429 is only a rate limit when none of these match.
const BILLING_CODES = Object.freeze(["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"])

// Hard ceilings that no stored configuration can exceed, whatever a Super Admin writes. They are enforced twice: config validation rejects
// a value above them, and effectiveCfg() clamps at use, so even a document written around the validator cannot raise a limit.
const CEILINGS = Object.freeze({ dailySuccessPerUser: 10, dailyAttemptsPerUser: 25, maxInputTokens: 3000, maxOutputTokens: 500, dailyGlobalTokens: 1500000, maxConcurrentPerInstance: 2, recoveryConcurrent: 2, timeoutMs: 8000 })
// Output the strict validator rejects is a product signal, not a provider failure: 8 rejected outputs among the last 10 validated responses open the breaker.
const INVALID_OUTPUT = Object.freeze({ window: 10, threshold: 8, cooldownSeconds: 900 })
// Actual input-token reports above the configured input limit mean the calibration no longer matches reality: that many hard-block Luna until an operator acts.
const INPUT_OVERRUN_LIMIT = 3
const MAX_COOLDOWN_SECONDS = 900
// Agreed cooldown ladder after repeated failed recovery probes (not simple doubling); it stays at the last step until the breaker closes again.
const COOLDOWN_STEPS = Object.freeze([60, 120, 300, 600, 900])
// Counted failures open the breaker on EITHER trigger: this many in a row (any provider response resets the run), or luna.breaker.failureThreshold (5) inside windowSeconds (60).
const CONSECUTIVE_FAILURES = 3
// If a breaker update cannot be committed, Luna is held off on this instance for this long even when the durable hold could not be written either.
const LOCAL_HOLD_MS = 60000
// ---- unresolved paid calls (round 4) ----
// begin() commits `unresolved: true` on the luna_r_* record BEFORE the provider request. It is cleared in the settle transaction only when the
// breaker already has the outcome; otherwise the outcome rides on the record itself (`pendingEvent`). admit() refuses to admit while any record is
// unresolved and OLDER than the grace period, after replaying it into the breaker.
// GRACE: how long a `called` record may be treated as a genuinely in-flight call. It is measured from the record's server-committed `calledAt`
// and must exceed the WHOLE life of the invocation that wrote it (provider call + breaker report + the rest of the chat handler + persistTurn), not
// only the HTTP timeout. A Cloud Functions 2nd-gen callable that sets no timeoutSeconds runs at most 60 s (aiChat sets none), so the instance that
// wrote `calledAt` cannot still be working after 60 s. Grace = that 60 s + 30 s for clock skew and scheduling = 90 s. A scan test pins FUNCTION_TIMEOUT_SECONDS
// to functions/index.js so raising the function timeout without raising the grace fails the build.
const FUNCTION_TIMEOUT_SECONDS = 60
const UNRESOLVED = Object.freeze({ graceMs: (FUNCTION_TIMEOUT_SECONDS + 30) * 1000, page: 50, chunk: 20, maxRounds: 6 })
const LEASE_MARGIN_MS = 2000 // a probe lease / recovery slot must outlive the provider timeout by at least this much

// Returns cfg with every Luna limit clamped to its ceiling and the breaker lease lengthened so it always outlives the provider timeout.
function effectiveCfg(cfg) {
  const L = (cfg && cfg.luna) || {}, lim = L.limits || {}, B = L.breaker || {}, out = {}
  for (const [k, ceil] of Object.entries(CEILINGS)) out[k] = Number.isFinite(lim[k]) ? Math.min(Math.floor(lim[k]), ceil) : ceil
  const minLease = Math.ceil((out.timeoutMs + LEASE_MARGIN_MS) / 1000)
  return { ...cfg, luna: { ...L, limits: { ...lim, ...out }, breaker: { ...B, leaseSeconds: Math.max(Number.isFinite(B.leaseSeconds) ? B.leaseSeconds : 0, minLease) } } }
}

module.exports = { MODEL, ENDPOINT, NOTICE_VERSION, GLOBAL_SHARDS, BYTE_CEILING, KINDS, BILLING_CODES, CEILINGS, INVALID_OUTPUT, INPUT_OVERRUN_LIMIT, MAX_COOLDOWN_SECONDS, COOLDOWN_STEPS, CONSECUTIVE_FAILURES, LOCAL_HOLD_MS, FUNCTION_TIMEOUT_SECONDS, UNRESOLVED, LEASE_MARGIN_MS, effectiveCfg }
