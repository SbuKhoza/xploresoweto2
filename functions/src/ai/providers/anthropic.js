"use strict"
// Anthropic adapter (first implementation of the provider interface in ./index.js).
// Constraints enforced here, all verified against Anthropic's docs (docs/stage2/VERIFICATION_RECORD.md):
//  * never sends temperature/top_p/top_k (HTTP 400 on Sonnet 5.5, to be omitted on Haiku 5.5)
//  * never forces tool_choice (HTTP 400 on Sonnet 5.5 / Opus 5.5): automatic only
//  * effort is sent as output_config.effort; thinking is left adaptive
//  * SDK retries are OFF (maxRetries: 0): the orchestrator owns retries so each one is bounded and accounted for
const { ProviderError } = require("../errors")

const STOP = { end_turn: "end", stop_sequence: "end", tool_use: "tool_use", max_tokens: "max_tokens", refusal: "refusal", pause_turn: "pause", model_context_window_exceeded: "max_tokens" }

function toAnthropicMessages(messages) {
  return messages.map((m) => {
    if (m.raw) return { role: m.role, content: m.raw } // assistant turns from the loop are replayed unchanged (incl. thinking blocks)
    if (m.toolResults) {
      return { role: "user", content: m.toolResults.map((r) => ({ type: "tool_result", tool_use_id: r.toolUseId, content: r.content, ...(r.isError ? { is_error: true } : {}) })) }
    }
    return { role: m.role, content: String(m.content) }
  })
}

function normalizeError(err) {
  if (err instanceof ProviderError) return err
  const status = typeof err?.status === "number" ? err.status : null
  const name = String(err?.name || "")
  const retryAfter = Number(err?.headers?.["retry-after"] ?? err?.headers?.get?.("retry-after"))
  const retryAfterMs = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 30000) : 0
  if (/Timeout|Abort/i.test(name) || status === 408 || status === 504) return new ProviderError("timeout", "provider timeout", { retryable: true, status })
  if (status === 429 || /RateLimit/i.test(name)) return new ProviderError("rate_limited", "provider rate limited", { retryable: true, retryAfterMs, status })
  if (status === 529 || /Overloaded/i.test(name)) return new ProviderError("overloaded", "provider overloaded", { retryable: true, retryAfterMs, status })
  if (status === 401 || status === 402 || status === 403 || /Authentication|PermissionDenied|PaymentRequired/i.test(name)) return new ProviderError("auth", "provider rejected credentials or billing", { status })
  if (status === 400 || status === 413 || status === 422 || /BadRequest|UnprocessableEntity|ContentTooLarge/i.test(name)) return new ProviderError("bad_request", "provider rejected the request", { status })
  if ((status && status >= 500) || /APIConnection|InternalServer|ServiceUnavailable|GatewayTimeout/i.test(name)) return new ProviderError("unavailable", "provider unavailable", { retryable: true, status })
  return new ProviderError("unknown", "provider error", { status })
}

function createAnthropicProvider({ apiKey, client } = {}) {
  let sdk = client
  const get = () => {
    if (sdk) return sdk
    if (!apiKey) throw new ProviderError("not_configured", "ANTHROPIC_API_KEY is not set")
    const Anthropic = require("@anthropic-ai/sdk")
    sdk = new (Anthropic.default || Anthropic.Anthropic || Anthropic)({ apiKey, maxRetries: 0 })
    return sdk
  }
  return {
    name: "anthropic",
    async generate({ model, system, messages, tools, maxTokens, effort, timeoutMs, signal }) {
      const params = {
        model,
        max_tokens: maxTokens,
        system: (system || []).map((b) => ({ type: "text", text: b.text, ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}) })),
        messages: toAnthropicMessages(messages),
      }
      if (tools && tools.length) params.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
      if (effort) params.output_config = { effort }
      let resp
      try {
        resp = await get().messages.create(params, { timeout: timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) })
      } catch (e) {
        throw normalizeError(e)
      }
      const blocks = Array.isArray(resp.content) ? resp.content : []
      const u = resp.usage || {}
      return {
        text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
        toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input })),
        stopReason: STOP[resp.stop_reason] || "other",
        rawStopReason: resp.stop_reason || null,
        usage: { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, cacheReadTokens: u.cache_read_input_tokens || 0, cacheWriteTokens: u.cache_creation_input_tokens || 0 },
        assistantMessage: { role: "assistant", raw: blocks },
        model: resp.model || model,
        providerRequestId: resp._request_id || null,
      }
    },
  }
}
module.exports = { createAnthropicProvider, normalizeError, toAnthropicMessages }
