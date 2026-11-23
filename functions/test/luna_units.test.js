"use strict"
// Luna wording layer: units (payloads, validator, provider classification, breaker, usage accounting). MOCKED provider only: no network, no key, no paid call.
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const F = require("./engine_fixture")
const prompt = require("../src/ai/luna/prompt")
const { validateRewrite } = require("../src/ai/luna/validate")
const provider = require("../src/ai/luna/provider")
const breaker = require("../src/ai/luna/breaker")
const usage = require("../src/ai/luna/usage")
const K = require("../src/ai/luna/constants")
const cfgMod = require("../src/ai/config")
const luna = require("../src/ai/luna")

let env
beforeEach(() => { env = F.setupWorld() })
const cfgWith = (over = {}) => cfgMod.merge(cfgMod.DEFAULTS, { luna: { enabled: true, ...over } })

// ------------------------------------------------------------------ payloads: a closed, calibrated universe
test("templates join back to Malloya's exact deterministic wording, and only rewritable segments are ever sent", () => {
  for (const [id, tpl] of Object.entries(prompt.TEMPLATES)) {
    assert.equal(prompt.joinSegments(tpl, null), tpl.deterministic, id)
    const p = prompt.buildPayload(id, "en")
    const sent = JSON.parse(p.input)
    assert.deepEqual(Object.keys(sent.segments), tpl.segments.filter((s) => s.rw).map((s) => s.id))
    for (const s of tpl.segments.filter((x) => !x.rw)) assert.ok(!p.input.includes(s.text.trim()), "pinned text must never be sent")
  }
})
test("the payload universe is closed: every payload has a calibration entry whose hash matches the CURRENT templates and instructions", () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "ai", "luna", "calibration.json"), "utf8"))
  const all = prompt.allPayloads()
  assert.deepEqual(Object.keys(m.payloads).sort(), all.map((p) => p.id).sort())
  for (const p of all) {
    assert.equal(m.payloads[p.id].sha256, p.sha256, `${p.id}: a template or the instructions changed. Run: npm run luna:calibrate`)
    assert.ok(p.withinByteCeiling, `${p.id} exceeds the byte ceiling`)
  }
  if (m.status === "calibrated") for (const p of all) assert.ok(Number.isInteger(m.payloads[p.id].inputTokens) && m.payloads[p.id].inputTokens <= 3000, p.id)
  else assert.equal(m.status, "uncalibrated") // an uncalibrated manifest means Luna is skipped (asserted in luna_flow.test.js)
})
test("a payload outside the calibrated set is never built: unknown template, unsupported language", () => {
  assert.equal(prompt.buildPayload("help", "en"), null); assert.equal(prompt.buildPayload("greeting", "zu"), null); assert.equal(prompt.buildPayload("nope", "en"), null)
})
test("only an EXACT known template block is rewritable: changed text, extra blocks, other intents and other languages are not", () => {
  const g = prompt.TEMPLATES.greeting.deterministic
  assert.ok(prompt.matchTemplate("greeting", [{ type: "verified", text: g }], "en"))
  assert.equal(prompt.matchTemplate("greeting", [{ type: "verified", text: g + " " }], "en"), null)
  assert.equal(prompt.matchTemplate("greeting", [{ type: "verified", text: g }, { type: "verified", text: "x" }], "en"), null)
  assert.equal(prompt.matchTemplate("help", [{ type: "verified", text: "I can: ..." }], "en"), null)
  assert.equal(prompt.matchTemplate("greeting", [{ type: "verified", text: g }], "zu"), null)
  assert.equal(prompt.matchTemplate("find_restaurants", [{ type: "verified", text: "Gogo's Kitchen is listed" }], "en"), null)
})
test("calibrated(): needs status, hash match, a measured count within the 3,000 limit, and the byte ceiling; anything else skips Luna", () => {
  const p = prompt.buildPayload("thanks", "en"), cfg = cfgWith()
  const mk = (over = {}, entry = {}) => ({ status: "calibrated", reasoningEffort: "none", payloads: { [p.id]: { sha256: p.sha256, inputTokens: 400, ...entry } }, ...over })
  const cal = (m, pay = p) => { luna.setDepsForTests({ manifest: m }); return luna.calibrated(pay, cfg) }
  assert.deepEqual(cal(mk()), { inputTokens: 400, reasoningEffort: "none" })
  assert.equal(cal(mk({ status: "uncalibrated" })), null); assert.equal(cal(mk({ reasoningEffort: null })), null); assert.equal(cal(mk({ reasoningEffort: "high" })), null)
  assert.equal(cal(mk({}, { sha256: "0".repeat(64) })), null); assert.equal(cal(mk({}, { inputTokens: null })), null)
  assert.equal(cal(mk({}, { inputTokens: 3001 })), null); assert.equal(cal(mk({}, { inputTokens: 0 })), null)
  assert.equal(cal(mk(), { ...p, withinByteCeiling: false }), null)
  assert.equal(cal({ status: "calibrated", reasoningEffort: "none", payloads: {} }), null)
})

// ------------------------------------------------------------------ validator: risky changes are REJECTED (no claim of semantic equivalence)
const thanks = prompt.TEMPLATES.thanks, greet = prompt.TEMPLATES.greeting
const out = (segments) => JSON.stringify({ segments })
test("validator accepts plain greetings, thanks and generic offers to help", () => {
  assert.deepEqual(validateRewrite(thanks, out({ all: "Anytime! Feel free to ask me anything else about Soweto." })), { ok: true, segments: { all: "Anytime! Feel free to ask me anything else about Soweto." } })
  assert.ok(validateRewrite(thanks, out({ all: "You're welcome! Ask me anything else about Soweto." })).ok) // unchanged is fine
  assert.ok(validateRewrite(greet, out({ open: "Hello and welcome to Soweto!", ask: "How can I help you today?" })).ok)
})
test("validator rejects every kind of risky change: facts, numbers, links, prices, promises, urgency, booking, capabilities, recommendations", () => {
  const bad = [
    "You're welcome! Visit Maponya Mall today.", "Thanks! Shops open at 9.", "You're welcome! Call 011 555 0100.", "Sure! See https://example.com", "Glad to help, it costs R80.",
    "You're welcome! I will book it for you.", "I'll reserve a table for you.", "Hurry, limited spots now!", "This is the best place, you must go.", "Guaranteed to be safe.",
    "No problem! I can find restaurants for you.", "Free entry for you!", "We will email you.", "Thanks 😊", "You're welcome!\nAsk me more.", "**Thanks** a lot", "Thanks <b>x</b>",
    "Dankie, ngiyabonga", "Thanks!!! Ask me anything else about Soweto??", "a", "x".repeat(101),
  ]
  for (const t of bad) assert.equal(validateRewrite(thanks, out({ all: t })).ok, false, t)
})
test("validator rejects malformed or reshaped output: not JSON, extra/missing/renamed segments, non-strings, wrong question shape", () => {
  for (const o of ["", "hello", "[]", "{}", '{"segments":[]}', '{"segments":{"all":"Thanks!"},"note":"x"}', '{"segments":{"all":5}}', '{"segments":{"other":"Thanks!"}}', '{"segments":{"all":"Thanks!","open":"Hi"}}', "x".repeat(5000)]) assert.equal(validateRewrite(thanks, o).ok, false, o)
  assert.equal(validateRewrite(greet, out({ open: "Hello!" })).ok, false) // missing the "ask" segment
  assert.equal(validateRewrite(greet, out({ open: "Hello!", ask: "What would you like to do." })).ok, false) // a question must stay a question
  assert.equal(validateRewrite(greet, out({ open: "Hello?", ask: "What would you like to do?" })).ok, false) // a statement must not become a question
})

// ------------------------------------------------------------------ provider: request shape and error classification
const resp = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body })
const okBody = (text, u = { input_tokens: 400, output_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: u })
const call = (fetchImpl, over = {}) => provider.callResponses({ payload: prompt.buildPayload("thanks", "en"), maxOutputTokens: 500, reasoningEffort: "none", timeoutMs: 200, fetchImpl, apiKey: "test-key-not-real", ...over })
test("provider request: fixed model, Responses API, no storage, strict schema, key only in the Authorization header, nothing about the user", async () => {
  let seen
  const r = await call(async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return resp(200, okBody("{}")) })
  assert.equal(seen.url, "https://api.openai.com/v1/responses"); assert.equal(seen.init.method, "POST")
  assert.equal(seen.body.model, "gpt-6-luna"); assert.equal(seen.body.store, false); assert.equal(seen.body.max_output_tokens, 500); assert.deepEqual(seen.body.reasoning, { effort: "none" })
  assert.equal(seen.body.text.format.type, "json_schema"); assert.equal(seen.body.text.format.strict, true)
  assert.equal(seen.init.headers.authorization, "Bearer test-key-not-real"); assert.ok(!seen.init.body.includes("test-key-not-real"))
  assert.deepEqual(Object.keys(seen.body).sort(), ["input", "instructions", "max_output_tokens", "model", "reasoning", "store", "text"])
  assert.deepEqual(r.usage, { input: 400, output: 30, cached: 0, reasoning: 0 })
})
test("provider: HTTP 429 is classified by the structured error code: billing/quota is NOT a rate limit", async () => {
  const cls = async (status, error, headers) => (await call(async () => resp(status, { error }, headers))).kind
  assert.equal(await cls(429, { type: "insufficient_quota", code: "insufficient_quota" }), "billing")
  assert.equal(await cls(429, { type: "insufficient_quota", code: "credit_balance_exhausted" }), "billing")
  assert.equal(await cls(429, { type: "insufficient_quota", code: "project_spend_limit_exceeded" }), "billing")
  assert.equal(await cls(429, { type: "x", code: "organization_usage_limit_exceeded" }), "billing")
  assert.equal(await cls(429, { type: "requests", code: "rate_limit_exceeded" }), "rate_limit")
  assert.equal(await cls(429, { type: "rate_limit_error", code: "slow_down" }), "rate_limit")
  assert.equal(await cls(429, undefined), "rate_limit")
  const r = await call(async () => resp(429, { error: { code: "rate_limit_exceeded" } }, { "retry-after": "17" })); assert.equal(r.retryAfterSeconds, 17)
  assert.equal(await cls(401, { code: "invalid_api_key" }), "auth"); assert.equal(await cls(403, {}), "auth")
  assert.equal(await cls(500, {}), "server"); assert.equal(await cls(503, {}), "server"); assert.equal(await cls(400, { code: "x" }), "bad_request"); assert.equal(await cls(404, {}), "bad_request")
})
test("provider: network errors, timeouts, incomplete and unusable responses are reported, never thrown, and never retried", async () => {
  let calls = 0
  assert.equal((await call(async () => { calls++; throw new Error("ECONNRESET") })).kind, "network")
  assert.equal((await call((url, init) => { calls++; return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) }, { timeoutMs: 30 })).kind, "timeout")
  assert.equal((await call(async () => { calls++; return resp(200, { status: "incomplete", output: [], usage: { input_tokens: 400, output_tokens: 500 } }) })).kind, "incomplete")
  const inc = await call(async () => resp(200, { status: "incomplete", output: [], usage: { input_tokens: 400, output_tokens: 500 } })); assert.deepEqual(inc.usage, { input: 400, output: 500, cached: 0, reasoning: 0 })
  assert.equal((await call(async () => { calls++; return resp(200, { status: "completed", output: [] }) })).kind, "invalid_response")
  assert.equal((await call(async () => { calls++; return { ok: false, status: 502, headers: { get: () => null }, json: async () => { throw new Error("html") } } })).kind, "server")
  assert.equal(calls, 5) // exactly one request per call: no automatic retries
  assert.equal((await provider.callResponses({ payload: prompt.buildPayload("thanks", "en"), maxOutputTokens: 500, timeoutMs: 50, fetchImpl: async () => { throw new Error("must not be called") }, apiKey: "" })).noKey, true)
})
test("provider tokens: cached and reasoning tokens are recorded when reported", () => {
  assert.deepEqual(provider.usageOf({ input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } }), { input: 10, output: 5, cached: 4, reasoning: 2 })
  assert.equal(provider.usageOf(undefined), null)
})

// ------------------------------------------------------------------ breaker: one GLOBAL probe, limited recovery, blocked billing state
const bcfg = (o) => cfgWith(o)
const state = () => env.get("ai-usage/luna-breaker")
const tick = (s) => { env.time.now += s * 1000 }
const failN = async (n, kind = "timeout", cfg = bcfg()) => { for (let i = 0; i < n; i++) await breaker.report({ owner: `r${i}`, mode: "normal", ok: false, kind, cfg }) }
test("breaker: closed by default; five counted failures inside the window open it; successes never write", async () => {
  const cfg = bcfg(); assert.deepEqual(await breaker.admit({ owner: "a", cfg }), { allowed: true, mode: "normal" })
  await breaker.report({ owner: "a", mode: "normal", ok: true, cfg }); assert.equal(state(), undefined)
  await failN(4); assert.equal(state().state, "closed"); await failN(1); assert.equal(state().state, "open")
  assert.deepEqual(await breaker.admit({ owner: "b", cfg }), { allowed: false, reason: "open" })
})
test("breaker: failures outside the window do not accumulate", async () => {
  const cfg = bcfg(); await failN(4); tick(61); await failN(4); assert.equal(state().state, "closed"); await failN(1); assert.equal(state().state, "open")
})
test("breaker: after the cooldown exactly ONE probe is allowed globally, even from many instances at once", async () => {
  const cfg = bcfg(); await failN(5); tick(61)
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => breaker.admit({ owner: `inst${i}`, cfg })))
  assert.equal(results.filter((r) => r.allowed).length, 1); assert.equal(results.find((r) => r.allowed).mode, "probe")
  assert.ok(results.filter((r) => !r.allowed).every((r) => r.reason === "probe-in-progress"))
})
test("breaker: a crashed probe holder cannot deadlock recovery: the lease expires and a new probe is allowed", async () => {
  const cfg = bcfg(); await failN(5); tick(61); assert.equal((await breaker.admit({ owner: "p1", cfg })).mode, "probe")
  assert.equal((await breaker.admit({ owner: "p2", cfg })).allowed, false); tick(31); assert.equal((await breaker.admit({ owner: "p3", cfg })).mode, "probe")
})
test("breaker: probe success -> recovery with at most 2 concurrent calls GLOBALLY for 60s, then closed; probe failure reopens with a longer cooldown", async () => {
  const cfg = bcfg(); await failN(5); tick(61)
  await breaker.admit({ owner: "p", cfg }); await breaker.report({ owner: "p", mode: "probe", ok: true, cfg }); assert.equal(state().state, "recovery")
  const a = await breaker.admit({ owner: "r1", cfg }), b = await breaker.admit({ owner: "r2", cfg }), c = await breaker.admit({ owner: "r3", cfg })
  assert.deepEqual([a.mode, b.mode, c.allowed, c.reason], ["recovery", "recovery", false, "recovery-capacity"])
  await breaker.report({ owner: "r1", mode: "recovery", ok: true, cfg }); assert.equal((await breaker.admit({ owner: "r4", cfg })).allowed, true) // a finished call frees a slot
  tick(61); assert.deepEqual(await breaker.admit({ owner: "r5", cfg }), { allowed: true, mode: "normal" }); assert.equal(state().state, "closed")
  // failure of the probe
  await failN(5); tick(61); await breaker.admit({ owner: "q", cfg }); await breaker.report({ owner: "q", mode: "probe", ok: false, kind: "server", cfg })
  assert.equal(state().state, "open"); assert.equal(state().cooldownSeconds, 120)
})
test("breaker: a 429 rate limit opens immediately and honours Retry-After; billing/auth BLOCK until an operator bumps luna.resetEpoch", async () => {
  const cfg = bcfg(); await breaker.report({ owner: "a", mode: "normal", ok: false, kind: "rate_limit", retryAfterSeconds: 200, cfg })
  assert.equal(state().state, "open"); tick(100); assert.equal((await breaker.admit({ owner: "b", cfg })).allowed, false); tick(101); assert.equal((await breaker.admit({ owner: "b", cfg })).mode, "probe")
  await breaker.report({ owner: "b", mode: "probe", ok: false, kind: "billing", cfg }); assert.equal(state().state, "blocked"); assert.equal(state().blockedKind, "billing")
  tick(100000); assert.deepEqual(await breaker.admit({ owner: "c", cfg }), { allowed: false, reason: "blocked" }) // no automatic retry, ever
  const fixed = bcfg({ resetEpoch: 1 }); assert.deepEqual(await breaker.admit({ owner: "c", cfg: fixed }), { allowed: true, mode: "normal" }); assert.equal(state().state, "closed")
})
test("breaker: an unreadable breaker means Luna is off, never a failure", async () => {
  const orig = env.db.collection.bind(env.db)
  env.db.collection = (n) => { const c = orig(n); const od = c.doc.bind(c); c.doc = (id) => { const d = od(id); if (id === "luna-breaker") d.get = async () => { throw new Error("unavailable") }; return d }; return c }
  assert.deepEqual(await breaker.admit({ owner: "a", cfg: bcfg() }), { allowed: false, reason: "breaker-unreadable" })
})
test("breaker: a probe that never reached the provider gives its lease back", async () => {
  const cfg = bcfg(); await failN(5); tick(61); const g = await breaker.admit({ owner: "p", cfg }); await breaker.release({ owner: "p", mode: g.mode })
  assert.equal((await breaker.admit({ owner: "q", cfg })).mode, "probe")
})

// ------------------------------------------------------------------ usage: durable "called" record, sharded global budget, accurate settlement
const shardTotal = () => env.list("ai-usage").filter((d) => d.id.startsWith("luna_g_")).reduce((a, d) => a + d.tokens, 0)
const ticketOf = async (uid, rid, cfg, reserve = 900) => usage.begin({ uid, requestId: rid, cfg, reserveTokens: reserve })
test("begin(): commits the request record as 'called' with the maximum reservation and counts the attempt; a repeated requestId can never begin again", async () => {
  const cfg = cfgWith(), t = await ticketOf("u1", "req-aaaa1111", cfg)
  assert.equal(t.ok, true); const rec = env.get(`ai-usage/${usage.requestRef("u1", "req-aaaa1111").id}`)
  assert.equal(rec.state, "called"); assert.equal(rec.reserved, 900); assert.equal(shardTotal(), 900)
  assert.equal(env.list("ai-usage").find((d) => d.id.startsWith("luna_u_u1")).attempts, 1)
  assert.deepEqual(await ticketOf("u1", "req-aaaa1111", cfg), { ok: false, reason: "request-seen" }); assert.equal(shardTotal(), 900) // no second reservation
  await usage.settleFailure({ uid: "u1", requestId: "req-aaaa1111", ticket: t, kind: "timeout", usage: null })
  assert.deepEqual(await ticketOf("u1", "req-aaaa1111", cfg), { ok: false, reason: "request-seen" }) // still never again after settlement
})
test("settlement accounting: provider-rejected calls release the reservation; possibly-processed calls stay charged; reported usage is charged exactly", async () => {
  const cfg = cfgWith(), settle = async (rid, kind, u) => { const t = await ticketOf("u1", rid, cfg); await usage.settleFailure({ uid: "u1", requestId: rid, ticket: t, kind, usage: u }); return shardTotal() }
  assert.equal(await settle("req-rate0001", "rate_limit", null), 0); assert.equal(await settle("req-auth0001", "auth", null), 0); assert.equal(await settle("req-bill0001", "billing", null), 0)
  assert.equal(await settle("req-time0001", "timeout", null), 900); assert.equal(await settle("req-serv0001", "server", null), 1800)
  assert.equal(await settle("req-rejc0001", "rejected", { input: 400, output: 25, cached: 0, reasoning: 0 }), 1800 + 425)
  const u = env.list("ai-usage").find((d) => d.id.startsWith("luna_u_u1")); assert.equal(u.attempts, 6); assert.equal(u.successes, 0); assert.equal(u.inputTokens, 400); assert.equal(u.outputTokens, 25)
})
test("begin(): per-user limits (successes and attempts per day) and the global budget are enforced; the budget can never be exceeded across shards", async () => {
  const cfg = cfgWith({ limits: { dailySuccessPerUser: 2, dailyAttemptsPerUser: 3, dailyGlobalTokens: 8000 } }) // 1000 per shard
  for (const [i, ok] of [[1, true], [2, true], [3, true], [4, false]]) assert.equal((await ticketOf("u1", `req-att${i}0000`, cfg, 100)).ok, ok)
  assert.equal((await ticketOf("u1", "req-att50000", cfg, 100)).reason, "daily-attempts")
  const small = cfgWith({ limits: { dailyGlobalTokens: 8000 } }); let granted = 0
  for (let i = 0; i < 40; i++) if ((await ticketOf(`g${i}`, `req-glob${i}000`, small, 900)).ok) granted++
  assert.equal(granted, 8); assert.ok(shardTotal() <= 8000)
  assert.equal((await ticketOf("late", "req-late00001", small, 900)).reason, "global-budget")
  assert.equal((await ticketOf("huge", "req-huge00001", small, 5000)).reason, "budget-too-small")
})
test("shards: requests spread over the global documents, and each request touches at most ONE global document normally", async () => {
  const cfg = cfgWith(); for (let i = 0; i < 40; i++) await ticketOf(`s${i}`, `req-spread${i}00`, cfg, 100)
  const shards = env.list("ai-usage").filter((d) => d.id.startsWith("luna_g_")); assert.ok(shards.length >= 5 && shards.length <= 8); assert.equal(shardTotal(), 4000)
})

// ------------------------------------------------------------------ calibration script (mocked: it is never run against the real API here)
test("calibration script: measures every payload once, prefers reasoning 'none', falls back to 'low' once, refuses over-limit or missing usage, writes nothing on failure", async () => {
  const { calibrate } = require("../scripts/luna-calibrate")
  const good = (input) => async () => ({ ok: true, text: JSON.stringify({ segments: { all: "Anytime! Feel free to ask me anything else about Soweto.", open: "Hello!", ask: "How can I help you today?" } }), usage: { input, output: 20, cached: 0, reasoning: 0 }, ms: 1 })
  let written = null, lines = []
  const run = (call, o = {}) => { written = null; lines = []; return calibrate({ call, write: (m) => { written = m }, out: (l) => lines.push(l), ...o }) }
  let r = await run(good(420)); assert.deepEqual([r.ok, r.calls], [true, 2]); assert.equal(written.status, "calibrated"); assert.equal(written.reasoningEffort, "none")
  assert.deepEqual(Object.values(written.payloads).map((e) => e.inputTokens), [420, 420]); assert.deepEqual(Object.values(written.payloads).map((e) => e.sha256), prompt.allPayloads().map((p) => p.sha256))
  const seen = []; r = await run(async (a) => { seen.push(a.reasoningEffort); return a.reasoningEffort === "none" ? { ok: false, kind: "bad_request" } : good(430)() })
  assert.deepEqual([r.ok, r.calls, written.reasoningEffort], [true, 3, "low"]); assert.deepEqual(seen, ["none", "low", "low"])
  r = await run(good(3001)); assert.equal(r.ok, false); assert.equal(written, null)
  r = await run(async () => ({ ok: true, text: "{}", usage: null, ms: 1 })); assert.equal(r.ok, false); assert.equal(written, null)
  r = await run(async () => ({ ok: false, kind: "billing" })); assert.equal(r.ok, false); assert.equal(written, null); assert.equal(r.calls, 1) // stops at the first failure, no retries
  r = await run(async () => { throw new Error("must not be called") }, { hashesOnly: true }); assert.deepEqual([r.ok, r.calls, written.status, written.reasoningEffort], [true, 0, "uncalibrated", null])
  assert.ok(!lines.join("\n").match(/Bearer|sk-|api[_-]?key/i))
})
