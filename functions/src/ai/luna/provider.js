"use strict"
// The ONLY file in the backend that talks to the network. Native fetch against the OpenAI Responses API; no SDK.
//  * The API key comes from the Firebase secret OPENAI_API_KEY (bound to aiChat only). It is read at call time, never logged or returned.
//  * No automatic retries: every call is paid, so a failure is reported once and the deterministic wording is used instead.
//  * Errors are classified from the structured error type/code (not from the HTTP status alone): a billing/quota 429 is NOT a rate limit.
const { MODEL, ENDPOINT, BILLING_CODES } = require("./constants")

const readKey = () => (typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "")
const hasKey = () => readKey().length > 0

// Pure: classify a failed HTTP response. body = parsed JSON or null.
function classifyHttpError(status, body, headers) {
  const err = body && typeof body === "object" && body.error && typeof body.error === "object" ? body.error : {}
  const type = typeof err.type === "string" ? err.type : "", code = typeof err.code === "string" ? err.code : ""
  if (status === 401 || status === 403) return { kind: "auth" }
  if (status === 429) {
    if (BILLING_CODES.includes(type) || BILLING_CODES.includes(code)) return { kind: "billing" }
    const ra = headers && typeof headers.get === "function" ? Number(headers.get("retry-after")) : NaN
    return { kind: "rate_limit", retryAfterSeconds: Number.isFinite(ra) && ra > 0 ? Math.min(Math.ceil(ra), 900) : null }
  }
  if (status >= 500) return { kind: "server" }
  return { kind: "bad_request" } // other 4xx (including 400/404/422): our request is wrong, retrying cannot help
}

function usageOf(u) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
  if (!u || typeof u !== "object") return null
  return { input: n(u.input_tokens), output: n(u.output_tokens), cached: n(u.input_tokens_details && u.input_tokens_details.cached_tokens), reasoning: n(u.output_tokens_details && u.output_tokens_details.reasoning_tokens) }
}
function outputTextOf(body) {
  if (!body || !Array.isArray(body.output)) return null
  for (const item of body.output) if (item && item.type === "message" && Array.isArray(item.content)) for (const c of item.content) if (c && c.type === "output_text" && typeof c.text === "string") return c.text
  return null
}

// -> { ok:true, text, usage, ms } | { ok:false, kind, retryAfterSeconds?, usage?, ms }
async function callResponses({ payload, maxOutputTokens, reasoningEffort, timeoutMs, fetchImpl, apiKey }) {
  const key = apiKey !== undefined ? apiKey : readKey()
  if (!key) return { ok: false, kind: "auth", noKey: true, ms: 0 }
  const doFetch = fetchImpl || globalThis.fetch
  const body = {
    model: MODEL, instructions: payload.instructions, input: payload.input, max_output_tokens: maxOutputTokens, store: false,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    text: { format: { type: "json_schema", name: "rewrite", strict: true, schema: payload.schema } },
  }
  const ctl = new AbortController(), t0 = Date.now(), timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    let res
    try { res = await doFetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: ctl.signal }) }
    catch (e) { return { ok: false, kind: ctl.signal.aborted ? "timeout" : "network", ms: Date.now() - t0 } }
    let parsed = null
    try { parsed = await res.json() } catch (e) { parsed = null }
    const ms = Date.now() - t0
    if (!res.ok) return { ok: false, ...classifyHttpError(res.status, parsed, res.headers), ms }
    const usage = usageOf(parsed && parsed.usage)
    if (parsed && parsed.status && parsed.status !== "completed") return { ok: false, kind: "incomplete", usage, ms }
    const text = outputTextOf(parsed)
    if (text === null) return { ok: false, kind: "invalid_response", usage, ms }
    return { ok: true, text, usage, ms }
  } catch (e) {
    return { ok: false, kind: ctl.signal.aborted ? "timeout" : "network", ms: Date.now() - t0 }
  } finally { clearTimeout(timer) }
}
module.exports = { callResponses, classifyHttpError, usageOf, outputTextOf, hasKey }
