"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setupAi } = require("./ai_helpers")
const { Ts } = require("./helpers")
const C = require("../src/ai/config")
const cost = require("../src/ai/cost")
const { createAnthropicProvider, normalizeError } = require("../src/ai/providers/anthropic")
const { ProviderError } = require("../src/ai/errors")
const { sanitizeText, normalizeName } = require("../src/ai/sanitize")
const geo = require("../src/ai/geo")
const log = require("../src/ai/log")

let env
beforeEach(() => { env = setupAi() })

// ---------------------------------------------------------------- configuration
test("config: defaults are valid and match the approved limits (10/day, 3/min, US$50, 90 days)", async () => {
  assert.deepEqual(C.validateConfig(C.DEFAULTS), [])
  const c = await C.getAiConfig()
  assert.deepEqual([c.limits.dailyMessages, c.limits.burstPerMinute, c.budget.monthlyUsd, c.retention.days], [10, 3, 50, 90])
  assert.deepEqual(c.models, { routine: "claude-haiku-5-5", planning: "claude-sonnet-5-5" })
})
test("config: an empty database works (defaults)", async () => { assert.equal((await C.getAiConfig()).enabled, true) })
test("config: valid overrides in ai-config/default take effect without a redeploy", async () => {
  env.seed("ai-config/default", { limits: { dailyMessages: 25 }, models: { routine: "claude-haiku-9-9" }, budget: { monthlyUsd: 80 } })
  const c = await C.getAiConfig()
  assert.deepEqual([c.limits.dailyMessages, c.limits.burstPerMinute, c.models.routine, c.models.planning, c.budget.monthlyUsd], [25, 3, "claude-haiku-9-9", "claude-sonnet-5-5", 80])
})
test("config: an INVALID or out-of-bounds stored override is ignored entirely (defaults stay in force)", async () => {
  for (const bad of [{ limits: { dailyMessages: 5000 } }, { limits: { burstPerMinute: 0 } }, { models: { routine: "../etc/passwd" } }, { budget: { monthlyUsd: -5 } }, { effort: { routine: "turbo" } }, { retention: { days: 9999 } }]) {
    env.seed("ai-config/default", bad); C.invalidateConfigCache()
    const c = await C.getAiConfig()
    assert.equal(c.limits.dailyMessages, 10); assert.equal(c.budget.monthlyUsd, 50); assert.equal(c.models.routine, "claude-haiku-5-5")
  }
  assert.ok(env.logs.some((l) => l.event === "ai.config.invalid_ignored"))
})
test("config: non-editable keys (provider, unknown) cannot be injected through the stored document", async () => {
  env.seed("ai-config/default", { provider: "evil", secretKey: "x", limits: { dailyMessages: 12 } })
  const c = await C.getAiConfig()
  assert.equal(c.provider, "anthropic"); assert.ok(!("secretKey" in c)); assert.equal(c.limits.dailyMessages, 12)
})

// ---------------------------------------------------------------- cost accounting from the verified price table
test("cost: tokens x USD-per-MTok is exact micro-USD (Sonnet 5.5: $2 in / $10 out)", async () => {
  const c = await C.getAiConfig()
  assert.equal(cost.costMicros("claude-sonnet-5-5", { inputTokens: 1e6, outputTokens: 1e6 }, c), 12e6)
  assert.equal(cost.costMicros("claude-sonnet-5-5", { inputTokens: 6000, outputTokens: 700 }, c), 19000) // $0.019
  assert.equal(cost.costMicros("claude-haiku-5-5", { inputTokens: 6000, outputTokens: 700 }, c), 950)   // $0.00095
  assert.equal(cost.costMicros("claude-sonnet-5-5", { cacheReadTokens: 1e6 }, c), 1e5)                 // $0.10 cache read (corrected figure)
})
test("cost: Haiku's long-prompt tier applies above 100K prompt tokens; unknown models use conservative fallback rates", async () => {
  const c = await C.getAiConfig()
  assert.equal(cost.costMicros("claude-haiku-5-5", { inputTokens: 200000, outputTokens: 0 }, c), 100000)  // 200K x $0.50/MTok
  assert.equal(cost.costMicros("claude-haiku-5-5", { inputTokens: 90000, outputTokens: 0 }, c), 9000)
  assert.ok(cost.costMicros("some-new-model", { inputTokens: 1e6, outputTokens: 1e6 }, c) > cost.costMicros("claude-sonnet-5-5", { inputTokens: 1e6, outputTokens: 1e6 }, c))
})
test("cost: the worst-case reservation grows with iterations and output size and always exceeds a typical real turn", async () => {
  const c = await C.getAiConfig(), base = { model: "claude-sonnet-5-5", baseChars: 15000, maxOutputTokens: 4500, iterations: 5, toolResultMaxChars: 6000 }
  const w = cost.estimateWorstCaseMicros(base, c)
  assert.ok(w > cost.estimateWorstCaseMicros({ ...base, iterations: 2 }, c)); assert.ok(w > cost.costMicros("claude-sonnet-5-5", { inputTokens: 6000, outputTokens: 700 }, c) * 5)
})

// ---------------------------------------------------------------- Anthropic adapter (request shaping + error mapping)
const fakeClient = (reply) => { const seen = []; return { seen, messages: { async create(params, opts) { seen.push({ params, opts }); if (reply instanceof Error) throw reply; return reply } } } }
const okReply = { model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "hello" }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 }, _request_id: "req_1" }
test("adapter: sends only verified parameters (no sampling params, no forced tool_choice, effort via output_config, no SDK retries)", async () => {
  const client = fakeClient(okReply), p = createAnthropicProvider({ client })
  await p.generate({ model: "claude-sonnet-5-5", system: [{ text: "static", cache: true }, { text: "dynamic" }], messages: [{ role: "user", content: "hi" }], tools: [{ name: "t", description: "d", inputSchema: { type: "object", properties: {} } }], maxTokens: 1234, effort: "medium", timeoutMs: 4000 })
  const { params, opts } = client.seen[0]
  assert.equal(params.model, "claude-sonnet-5-5"); assert.equal(params.max_tokens, 1234); assert.deepEqual(params.output_config, { effort: "medium" })
  for (const k of ["temperature", "top_p", "top_k", "tool_choice"]) assert.ok(!(k in params), `${k} must not be sent`)
  assert.deepEqual(params.system[0], { type: "text", text: "static", cache_control: { type: "ephemeral" } }); assert.ok(!("cache_control" in params.system[1]))
  assert.deepEqual(params.tools[0], { name: "t", description: "d", input_schema: { type: "object", properties: {} } })
  assert.deepEqual([opts.timeout, opts.maxRetries], [4000, 0])
})
test("adapter: omits tools/effort when not requested; replays assistant raw blocks and tool results unchanged", async () => {
  const client = fakeClient(okReply), p = createAnthropicProvider({ client })
  const raw = [{ type: "thinking", thinking: "x", signature: "sig" }, { type: "tool_use", id: "tu1", name: "t", input: { a: 1 } }]
  await p.generate({ model: "claude-haiku-5-5", system: [{ text: "s" }], maxTokens: 100, timeoutMs: 1000, messages: [{ role: "user", content: "q" }, { role: "assistant", raw }, { role: "user", toolResults: [{ toolUseId: "tu1", content: "{}", isError: true }] }] })
  const { params } = client.seen[0]
  assert.ok(!("tools" in params) && !("output_config" in params))
  assert.deepEqual(params.messages[1], { role: "assistant", content: raw })
  assert.deepEqual(params.messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "{}", is_error: true }] })
})
test("adapter: normalises text, tool calls, all cache usage fields and the request id", async () => {
  const r = await createAnthropicProvider({ client: fakeClient({ ...okReply, stop_reason: "tool_use", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "tool_use", id: "t1", name: "searchListings", input: { q: 1 } }] }) }).generate({ model: "m", system: [], messages: [], maxTokens: 10, timeoutMs: 1 })
  assert.equal(r.text, "a\nb"); assert.deepEqual(r.toolCalls, [{ id: "t1", name: "searchListings", input: { q: 1 } }]); assert.equal(r.stopReason, "tool_use")
  assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 }); assert.equal(r.providerRequestId, "req_1")
})
test("adapter: every documented stop_reason is mapped (refusal, max_tokens, pause_turn, context window ...)", async () => {
  const map = { end_turn: "end", stop_sequence: "end", tool_use: "tool_use", max_tokens: "max_tokens", refusal: "refusal", pause_turn: "pause", model_context_window_exceeded: "max_tokens", something_new: "other" }
  for (const [raw, want] of Object.entries(map)) assert.equal((await createAnthropicProvider({ client: fakeClient({ ...okReply, stop_reason: raw }) }).generate({ model: "m", system: [], messages: [], maxTokens: 1, timeoutMs: 1 })).stopReason, want, raw)
})
test("adapter: provider errors become ProviderError with the right kind/retryability (no vendor classes leak)", async () => {
  const E = (name, status, headers) => Object.assign(new Error("x"), { name, status, headers })
  const cases = [[E("RateLimitError", 429, { "retry-after": "7" }), "rate_limited", true], [E("OverloadedError", 529), "overloaded", true], [E("APIConnectionTimeoutError"), "timeout", true], [E("APIUserAbortError"), "timeout", true],
    [E("InternalServerError", 500), "unavailable", true], [E("APIConnectionError"), "unavailable", true], [E("AuthenticationError", 401), "auth", false], [E("PaymentRequiredError", 402), "auth", false],
    [E("PermissionDeniedError", 403), "auth", false], [E("BadRequestError", 400), "bad_request", false], [E("Error"), "unknown", false]]
  for (const [err, kind, retryable] of cases) { const pe = normalizeError(err); assert.ok(pe instanceof ProviderError); assert.deepEqual([pe.kind, pe.retryable], [kind, retryable], err.name) }
  assert.equal(normalizeError(E("RateLimitError", 429, { "retry-after": "7" })).retryAfterMs, 7000)
  await assert.rejects(createAnthropicProvider({ client: fakeClient(E("RateLimitError", 429)) }).generate({ model: "m", system: [], messages: [], maxTokens: 1, timeoutMs: 1 }), (e) => e instanceof ProviderError && e.kind === "rate_limited")
})
test("adapter: a missing API key is a controlled not_configured error and the key is never echoed", async () => {
  await assert.rejects(createAnthropicProvider({}).generate({ model: "m", system: [], messages: [], maxTokens: 1, timeoutMs: 1 }), (e) => e.kind === "not_configured" && !/sk-ant/.test(e.message))
})

// ---------------------------------------------------------------- sanitisation, geo, logging
test("sanitize: strips markup, links and control characters, collapses space and truncates", () => {
  assert.equal(sanitizeText("<b>Hi</b>\u0000 [click](http://evil.example/x)  see https://evil.example/y now"), "Hi click see [link removed] now")
  assert.equal(sanitizeText("x".repeat(500), 20).length, 20); assert.equal(sanitizeText(null), ""); assert.equal(sanitizeText({ a: 1 }), "")
  assert.equal(normalizeName("  Sakhumzi  Restaurant! "), "sakhumzi restaurant")
})
test("geo: straight-line distance is plausible, coordinates are read in either shape, and the label forbids travel-time claims", () => {
  const km = geo.haversineKm({ latitude: -26.2041, longitude: 28.0473 }, { latitude: -25.7479, longitude: 28.2293 })
  assert.ok(km > 50 && km < 62, String(km))
  assert.deepEqual(geo.readCoords({ coordinates: { lat: "-26.2", lng: "28.0" } }), { latitude: -26.2, longitude: 28.0 }); assert.equal(geo.readCoords({ coordinates: { latitude: 99, longitude: 0 } }), null)
  assert.match(geo.DISTANCE_NOTE, /not driving distance or travel time/)
})
test("log: only allow-listed scalar fields are emitted; message text, tool arguments and raw uids can never appear", () => {
  const seen = []; log.setLogSinkForTests((e) => seen.push(e))
  log.info("ai.chat", { requestId: "r1", uidHash: log.uidHash("user-secret-uid"), message: "my private question", text: "x", args: { q: 1 }, location: { latitude: 1 }, content: "y", model: "m", inputTokens: 5 })
  const out = JSON.stringify(seen[0])
  assert.ok(!/private question|user-secret-uid|latitude/.test(out)); assert.equal(seen[0].inputTokens, 5); assert.equal(log.uidHash("user-secret-uid"), log.uidHash("user-secret-uid")); assert.equal(log.uidHash("a").length, 12)
})
