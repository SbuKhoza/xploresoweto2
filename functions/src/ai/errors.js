"use strict"
const { HttpsError } = require("firebase-functions/v2/https")

// Provider failures, normalised so the orchestrator never depends on a vendor's error classes.
class ProviderError extends Error {
  constructor(kind, message, { retryable = false, retryAfterMs = 0, status = null } = {}) {
    super(message || kind)
    this.name = "ProviderError"
    this.kind = kind // timeout | rate_limited | overloaded | unavailable | auth | bad_request | not_configured | unknown
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
    this.status = status
  }
}
// Controlled, non-leaky errors for clients: the message is a stable code, details carry only safe numbers.
const aiError = (code, appCode, details) => new HttpsError(code, appCode, details)
module.exports = { ProviderError, aiError }
