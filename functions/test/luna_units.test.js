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
test("the AI Service Notice matches reality: a payload is built only from fixed instructions, template text and a language code", () => {
  const body = (p) => JSON.parse(p.input)
  for (const p of prompt.allPayloads()) {
    assert.deepEqual(Object.keys(body(p)).sort(), ["language", "segments"]); assert.equal(body(p).language, "en")
    for (const text of Object.values(body(p).segments)) assert.ok(Object.values(prompt.TEMPLATES).some((t) => t.segments.some((s) => s.rw && s.text === text)), "only fixed template text may be sent")
    assert.deepEqual(Object.keys(p).sort(), ["bytes", "id", "input", "instructions", "language", "original", "schema", "sha256", "templateId", "withinByteCeiling"]) // no field that could carry user data
  }
  const src = require("node:fs").readFileSync(path.join(__dirname, "..", "src", "ai", "luna", "index.js"), "utf8")
  const args = src.match(/deps\.callResponses\(\{([^}]*)\}\)/)[1] // the ONLY arguments the provider call receives
  assert.deepEqual(args.split(",").map((a) => a.split(":")[0].trim()).sort(), ["maxOutputTokens", "payload", "reasoningEffort", "timeoutMs"]) // never a message, uid, location or request id
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
test("breaker: recovery concurrency is a SHARED limit: ten instances asking at the same moment get at most 2 slots in total", async () => {
  const cfg = bcfg(); await failN(5); tick(61); await breaker.admit({ owner: "p", cfg }); await breaker.report({ owner: "p", mode: "probe", ok: true, cfg })
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => breaker.admit({ owner: `inst${i}`, cfg })))
  assert.equal(results.filter((r) => r.allowed).length, 2); assert.ok(results.filter((r) => !r.allowed).every((r) => r.reason === "recovery-capacity"))
  assert.equal(Object.keys(state().inflight).length, 2) // the shared document holds exactly the two live slots
  tick(31); assert.equal((await breaker.admit({ owner: "late", cfg })).allowed, true) // slots of crashed holders expire (lease), they cannot leak
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
test("budget: a request that begins before midnight (SAST) and settles after it is reconciled against the day it reserved on", async () => {
  const cfg = cfgWith(); env.time.now = Date.UTC(2026, 10, 14, 21, 59, 50) // 23:59:50 SAST
  const t = await ticketOf("u1", "req-midnight1", cfg); const day = t.day; env.time.now += 30000 // 00:00:20 next day
  await usage.settleFailure({ uid: "u1", requestId: "req-midnight1", ticket: t, kind: "rate_limit", usage: null })
  const old = env.list("ai-usage").filter((d) => d.id.startsWith(`luna_g_${day}_`)).reduce((a, d) => a + d.tokens, 0)
  assert.equal(old, 0); assert.equal(env.list("ai-usage").filter((d) => d.id.startsWith("luna_g_") && !d.id.startsWith(`luna_g_${day}_`)).length, 0) // released from the ORIGINAL day, nothing created for the new day
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

test("ordering is structural, not accidental: in luna/index.js the durable 'called' commit (usage.begin) is awaited BEFORE the provider call, and nothing network-related precedes it", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "ai", "luna", "index.js"), "utf8")
  const begin = src.indexOf("await usage.begin("), call = src.indexOf("await deps.callResponses(")
  assert.ok(begin > 0 && call > begin, "usage.begin must come first")
  assert.equal((src.match(/deps\.callResponses\(/g) || []).length, 1) // exactly one provider call site, and no loop or retry around it
  assert.doesNotMatch(src.slice(src.indexOf("inflight += 1"), call + 220), /\b(for|while)\s*\(|setTimeout|\bretry\b/i) // no loop, timer or retry between the reservation and the single call
})

// ================================================================== ROUND 2: ceilings, owner key, breaker completeness, retention
const CEIL = { dailySuccessPerUser: 10, dailyAttemptsPerUser: 25, maxInputTokens: 3000, maxOutputTokens: 500, dailyGlobalTokens: 1500000, maxConcurrentPerInstance: 2, recoveryConcurrent: 2, timeoutMs: 8000 }
test("ceilings: the hard ceilings are exactly the agreed limits, and the defaults equal them", () => {
  assert.deepEqual({ ...K.CEILINGS }, CEIL); assert.deepEqual({ ...cfgMod.DEFAULTS.luna.limits }, CEIL)
  assert.deepEqual([K.INVALID_OUTPUT.window, K.INVALID_OUTPUT.threshold, K.INVALID_OUTPUT.cooldownSeconds, K.INPUT_OVERRUN_LIMIT, K.MAX_COOLDOWN_SECONDS], [10, 8, 900, 3, 900])
})
test("ceilings: config validation rejects every limit one above its ceiling and accepts the ceiling itself", () => {
  for (const [k, v] of Object.entries(CEIL)) {
    const over = cfgMod.merge(cfgMod.DEFAULTS, { luna: { limits: { [k]: v + 1 } } }); assert.ok(cfgMod.validateConfig(over).length > 0, `${k} above ceiling must be refused`)
    assert.deepEqual(cfgMod.validateConfig(cfgMod.merge(cfgMod.DEFAULTS, { luna: { limits: { [k]: v } } })), [], `${k} at ceiling is allowed`)
  }
})
test("ceilings: effectiveCfg clamps a crafted over-ceiling config that bypassed the validator, and never raises a lower value", () => {
  const crafted = cfgMod.merge(cfgMod.DEFAULTS, { luna: { limits: { dailySuccessPerUser: 999, dailyAttemptsPerUser: 999, maxInputTokens: 99999, maxOutputTokens: 99999, dailyGlobalTokens: 99999999, maxConcurrentPerInstance: 50, recoveryConcurrent: 50, timeoutMs: 600000 } } })
  assert.deepEqual({ ...K.effectiveCfg(crafted).luna.limits }, CEIL)
  assert.equal(K.effectiveCfg(cfgWith({ limits: { dailySuccessPerUser: 3 } })).luna.limits.dailySuccessPerUser, 3)
  const garbage = cfgMod.merge(cfgMod.DEFAULTS, { luna: { limits: { timeoutMs: "x", maxOutputTokens: null } } }); assert.equal(K.effectiveCfg(garbage).luna.limits.timeoutMs, 8000); assert.equal(K.effectiveCfg(garbage).luna.limits.maxOutputTokens, 500)
})
test("lease vs timeout: validation requires lease >= 10 s and the effective lease always outlives the provider timeout by 2 s", () => {
  assert.ok(cfgMod.validateConfig(cfgMod.merge(cfgMod.DEFAULTS, { luna: { breaker: { leaseSeconds: 9 } } })).length > 0)
  assert.deepEqual(cfgMod.validateConfig(cfgMod.merge(cfgMod.DEFAULTS, { luna: { breaker: { leaseSeconds: 10 } } })), [])
  const e = K.effectiveCfg(cfgMod.merge(cfgMod.DEFAULTS, { luna: { limits: { timeoutMs: 8000 }, breaker: { leaseSeconds: 1 } } })); assert.ok(e.luna.breaker.leaseSeconds * 1000 >= e.luna.limits.timeoutMs + K.LEASE_MARGIN_MS)
})
test("provider classification: 400/404/405/413/415/422 are configuration errors (bad_request); 408/409/425 and unknown 4xx are counted, not blocked", async () => {
  for (const st of [400, 404, 405, 413, 415, 422]) assert.equal(provider.classifyHttpError(st, {}, null).kind, "bad_request", String(st))
  for (const st of [408, 409, 425, 418, 451]) assert.equal(provider.classifyHttpError(st, {}, null).kind, "server", String(st))
  assert.equal(K.KINDS.bad_request.breaker, "blocked"); assert.equal(K.KINDS.bad_request.charge, false)
})
test("breaker: HTTP 400/404 style errors hard-block Luna in every mode, with no automatic retry, until an operator raises resetEpoch", async () => {
  for (const mode of ["normal", "probe", "recovery"]) {
    env = F.setupWorld(); const cfg = bcfg()
    if (mode !== "normal") { await failN(5); tick(61); await breaker.admit({ owner: "p", cfg }); if (mode === "recovery") { await breaker.report({ owner: "p", mode: "probe", ok: true, cfg }); await breaker.admit({ owner: "r", cfg }) } }
    await breaker.report({ owner: "r", mode, ok: false, kind: "bad_request", cfg })
    assert.equal(state().state, "blocked", mode); assert.equal(state().blockedKind, "bad_request", mode)
    tick(1000000); assert.deepEqual(await breaker.admit({ owner: "z", cfg }), { allowed: false, reason: "blocked" }, mode)
    assert.deepEqual(await breaker.admit({ owner: "z", cfg: bcfg({ resetEpoch: 1 }) }), { allowed: true, mode: "normal" }, mode); assert.equal(state().state, "closed")
  }
})
test("breaker owner: ownerKey depends on BOTH uid and requestId, is stable, and leaks neither", () => {
  const a = breaker.ownerKey("alice", "req-same0001"), b = breaker.ownerKey("bob", "req-same0001")
  assert.notEqual(a, b); assert.equal(a, breaker.ownerKey("alice", "req-same0001")); assert.notEqual(a, breaker.ownerKey("alice", "req-same0002"))
  assert.match(a, /^[0-9a-f]{32}$/); assert.ok(!a.includes("alice") && !a.includes("same"))
  assert.notEqual(breaker.ownerKey("a:b", "c"), breaker.ownerKey("a", "b:c")) // no ambiguity from the separator
})
test("breaker recovery: two users with the SAME requestId occupy two slots and cannot exceed the global cap of 2", async () => {
  const cfg = bcfg(); await failN(5); tick(61); await breaker.admit({ owner: "p", cfg }); await breaker.report({ owner: "p", mode: "probe", ok: true, cfg })
  const rid = "req-same0001", o = (u) => breaker.ownerKey(u, rid)
  const got = []; for (const u of ["alice", "bob", "carol", "dave"]) got.push((await breaker.admit({ owner: o(u), cfg })).allowed)
  assert.deepEqual(got, [true, true, false, false]); assert.equal(Object.keys(state().inflight).length, 2)
  const par = await Promise.all(["e", "f", "g"].map((u) => breaker.admit({ owner: o(u), cfg }))); assert.equal(par.filter((x) => x.allowed).length, 0) // still full
  await breaker.report({ owner: o("alice"), mode: "recovery", ok: true, cfg }); assert.equal(Object.keys(state().inflight).length, 1) // alice's report frees alice's slot only
  assert.equal((await breaker.admit({ owner: o("carol"), cfg })).allowed, true)
})
const okReport = (cfg, extra = {}) => breaker.report({ owner: "o", mode: "normal", ok: true, cfg, ...extra })
test("breaker invalid-output: 8 rejected among the last 10 open it for 900 s; 7 do not; accepted outputs age rejections out", async () => {
  const cfg = bcfg()
  for (let i = 0; i < 7; i++) await okReport(cfg, { rejected: true }); assert.equal(state().state, "closed"); assert.equal(state().invalid.length, 7)
  await okReport(cfg, { rejected: true }); assert.equal(state().state, "open"); assert.equal(state().cooldownSeconds, 900); assert.deepEqual(state().invalid, []) // 8 of 8 -> open
  assert.equal(state().cooldownUntil, env.time.now + 900000)
  tick(899); assert.equal((await breaker.admit({ owner: "x", cfg })).allowed, false); tick(2); assert.equal((await breaker.admit({ owner: "x", cfg })).mode, "probe")
})
test("breaker invalid-output: the window is the last 10, so 7 rejections + accepts never reach 8; a rejection streak after accepts still does", async () => {
  const cfg = bcfg()
  for (let i = 0; i < 7; i++) await okReport(cfg, { rejected: true }); for (let i = 0; i < 3; i++) await okReport(cfg) // 7 bad then 3 good: window = 7 of 10
  assert.equal(state().state, "closed"); await okReport(cfg, { rejected: true }) // window slides: 6 bad + 3 good + 1 bad = 7 of 10
  assert.equal(state().state, "closed"); assert.equal(state().invalid.length, 10); assert.equal(state().invalid.reduce((a, b) => a + b, 0), 7)
  let n = 0; while (state().state === "closed" && n < 12) { assert.ok((state().invalid || []).reduce((x, y) => x + y, 0) <= 7); await okReport(cfg, { rejected: true }); n++ }
  assert.equal(state().state, "open"); assert.ok(n <= 10) // the old accepts rotate out of the window of 10, then the 8th rejection opens it
  assert.equal(state().cooldownSeconds, 900)
})
test("breaker invalid-output: a clean provider history keeps the document untouched (no write on the hot path)", async () => {
  const cfg = bcfg(); for (let i = 0; i < 20; i++) await okReport(cfg); assert.equal(state(), undefined)
  await okReport(cfg, { rejected: true }); await okReport(cfg); assert.deepEqual(state().invalid, [1, 0])
})
test("breaker input-overrun: 3 reports above the input limit hard-block (needs an operator); 2 do not; the count survives other state changes", async () => {
  const cfg = bcfg(); await okReport(cfg, { overrun: true }); await okReport(cfg, { overrun: true }); assert.equal(state().state, "closed"); assert.equal(state().overruns, 2)
  await failN(5); assert.equal(state().state, "open"); assert.equal(state().overruns, 2) // counter kept across an open/close cycle
  tick(61); await breaker.admit({ owner: "p", cfg }); await breaker.report({ owner: "p", mode: "probe", ok: true, overrun: true, cfg })
  assert.equal(state().state, "blocked"); assert.equal(state().blockedKind, "input_overrun")
  tick(10000000); assert.deepEqual(await breaker.admit({ owner: "q", cfg }), { allowed: false, reason: "blocked" })
  assert.deepEqual(await breaker.admit({ owner: "q", cfg: bcfg({ resetEpoch: 1 }) }), { allowed: true, mode: "normal" }); assert.equal(state().state, "closed"); assert.equal(state().overruns, 0)
})
test("breaker: a late success report cannot un-block a blocked breaker or change anything", async () => {
  const cfg = bcfg(); await breaker.report({ owner: "a", mode: "normal", ok: false, kind: "auth", cfg }); const before = JSON.stringify(state())
  await okReport(cfg, { rejected: true }); await okReport(cfg, { overrun: true }); assert.equal(JSON.stringify(state()), before)
})
test("retention: request records live 400 days (longer than the longest replay window), user/shard counters stay short-lived", async () => {
  assert.equal(K.REQUEST_RECORD_TTL_DAYS, 400)
  const t = await ticketOf("ttl-user", "req-ttl00001", cfgWith(), 900); assert.equal(t.ok, true)
  const rec = env.list("ai-usage").find((d) => d.id.startsWith("luna_r_")); const days = (ts) => Math.round((ts.toMillis() - env.time.now) / 86400000)
  assert.equal(days(rec.expireAt), 400); assert.equal(days(env.list("ai-usage").find((d) => d.id.startsWith("luna_u_")).expireAt), 3)
  assert.ok(400 > cfgMod.DEFAULTS.retention.days && 400 > 365) // outlives stored replies (max 365 days) and the 90-day default
})
