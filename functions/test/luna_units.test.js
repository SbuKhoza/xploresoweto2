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
beforeEach(() => { env = F.setupWorld(); breaker.resetLocalForTests() })
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
// A failure followed by a provider answer: the answer resets the consecutive run, so only the 5-in-60-seconds trigger can fire.
const failSpread = async (n, cfg = bcfg()) => { for (let i = 0; i < n; i++) { await breaker.report({ owner: `s${i}`, mode: "normal", ok: false, kind: "timeout", cfg }); await breaker.report({ owner: `k${i}`, mode: "normal", ok: true, cfg }) } }
test("breaker: closed by default; successes never write", async () => {
  const cfg = bcfg(); assert.deepEqual(await breaker.admit({ owner: "a", cfg }), { allowed: true, mode: "normal" })
  await breaker.report({ owner: "a", mode: "normal", ok: true, cfg }); assert.equal(state(), undefined)
})
test("breaker trigger A: 3 CONSECUTIVE counted failures open it (2 do not)", async () => {
  const cfg = bcfg(); await failN(2); assert.equal(state().state, "closed"); assert.equal(state().consecutive, 2); await failN(1); assert.equal(state().state, "open"); assert.equal(state().cooldownSeconds, 60)
  assert.deepEqual(await breaker.admit({ owner: "b", cfg }), { allowed: false, reason: "open" })
})
test("breaker trigger A: a successful provider response resets the consecutive run", async () => {
  const cfg = bcfg(); await failN(2); await breaker.report({ owner: "ok", mode: "normal", ok: true, cfg }); assert.equal(state().consecutive, 0); await failN(2); assert.equal(state().state, "closed"); await failN(1); assert.equal(state().state, "open")
  // a rejected-but-delivered response also proves the provider is answering
  env = F.setupWorld(); await failN(2); await breaker.report({ owner: "rj", mode: "normal", ok: true, rejected: true, cfg }); assert.equal(state().consecutive, 0)
})
test("breaker trigger B: 5 counted failures within 60 s open it even when answers are interleaved (no 3 in a row)", async () => {
  const cfg = bcfg(); await failSpread(4, cfg); assert.equal(state().state, "closed"); assert.equal(state().failures.length, 4); await failSpread(1, cfg); assert.equal(state().state, "open"); assert.equal(state().cooldownSeconds, 60)
})
test("breaker trigger B: failures outside the 60 s window do not accumulate", async () => {
  const cfg = bcfg(); await failSpread(4, cfg); tick(61); await failSpread(4, cfg); assert.equal(state().state, "closed"); await failSpread(1, cfg); assert.equal(state().state, "open")
})
test("breaker triggers: rate-limit still opens at once; blocked kinds still block at once; neither needs 3", async () => {
  const cfg = bcfg(); await breaker.report({ owner: "x", mode: "normal", ok: false, kind: "rate_limit", retryAfterSeconds: 200, cfg }); assert.deepEqual([state().state, state().cooldownSeconds], ["open", 200])
  env = F.setupWorld(); await breaker.report({ owner: "y", mode: "normal", ok: false, kind: "billing", cfg }); assert.equal(state().state, "blocked")
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
test("retention: request records carry NO expireAt (never expire); the day-scoped counters still expire after 3 days", async () => {
  assert.equal(K.REQUEST_RECORD_TTL_DAYS, undefined) // the constant no longer exists
  const t = await ticketOf("ttl-user", "req-ttl00001", cfgWith(), 900); assert.equal(t.ok, true)
  const rec = env.list("ai-usage").find((d) => d.id.startsWith("luna_r_")); const days = (ts) => Math.round((ts.toMillis() - env.time.now) / 86400000)
  assert.equal(rec.expireAt, undefined); assert.equal(days(env.list("ai-usage").find((d) => d.id.startsWith("luna_u_")).expireAt), 3)
})

// ================================================================== ROUND 3: cooldown ladder, fail-closed breaker, record retention
const breakerTxFails = (when, readsToo = false) => { // fails transactions that WRITE the breaker (readsToo: also those that merely read it, i.e. the reconcile transaction) // make every transaction that touches the breaker document throw while `when()` is true; returns a restore function
  const real = env.db.runTransaction.bind(env.db)
  env.db.runTransaction = async (fn) => {
    if (!when()) return real(fn)
    let touches = false; const probe = { get: async (r) => { if (readsToo && r.path === "ai-usage/luna-breaker") touches = true; return { exists: false, data: () => ({}) } }, set(r) { if (r.path === "ai-usage/luna-breaker") touches = true }, delete() {} } // fails only transactions that WRITE the breaker (begin() merely reads it)
    try { await fn(probe) } catch (e) { /* ignore: only used to see which documents the callback touches */ }
    if (touches) throw Object.assign(new Error("UNAVAILABLE: simulated breaker transaction failure"), { code: 14 })
    return real(fn)
  }
  return () => { env.db.runTransaction = real }
}
test("cooldown ladder: 60, 120, 300, 600, 900 s after repeated failed probes, then it stays at 900", async () => {
  assert.deepEqual([...K.COOLDOWN_STEPS], [60, 120, 300, 600, 900])
  const cfg = bcfg(); await failN(3); const seen = [state().cooldownSeconds]
  for (let i = 0; i < 6; i++) {
    tick(state().cooldownSeconds + 1); const g = await breaker.admit({ owner: `p${i}`, cfg }); assert.equal(g.mode, "probe")
    await breaker.report({ owner: `p${i}`, mode: "probe", ok: false, kind: "timeout", cfg }); assert.equal(state().state, "open"); seen.push(state().cooldownSeconds)
  }
  assert.deepEqual(seen, [60, 120, 300, 600, 900, 900, 900])
})
test("cooldown ladder: not simple doubling (120 -> 300, not 240), and every step is honoured by admit()", async () => {
  const cfg = bcfg(); await failN(3); tick(61); await breaker.admit({ owner: "a", cfg }); await breaker.report({ owner: "a", mode: "probe", ok: false, kind: "timeout", cfg }); assert.equal(state().cooldownSeconds, 120)
  tick(119); assert.equal((await breaker.admit({ owner: "b", cfg })).allowed, false); tick(2); assert.equal((await breaker.admit({ owner: "c", cfg })).mode, "probe")
  await breaker.report({ owner: "c", mode: "probe", ok: false, kind: "timeout", cfg }); assert.equal(state().cooldownSeconds, 300); assert.equal(state().cooldownStep, 2)
})
test("cooldown ladder: Retry-After longer than the step wins (capped at 900); a failed recovery call also climbs a step; a clean recovery resets the ladder", async () => {
  const cfg = bcfg(); await failN(3); tick(61); await breaker.admit({ owner: "a", cfg }); await breaker.report({ owner: "a", mode: "probe", ok: false, kind: "rate_limit", retryAfterSeconds: 5000, cfg }); assert.equal(state().cooldownSeconds, 900)
  env = F.setupWorld(); await failN(3); tick(61); await breaker.admit({ owner: "a", cfg }); await breaker.report({ owner: "a", mode: "probe", ok: true, cfg }); assert.deepEqual([state().state, state().cooldownStep], ["recovery", 0])
  await breaker.admit({ owner: "r", cfg }); await breaker.report({ owner: "r", mode: "recovery", ok: false, kind: "server", cfg }); assert.deepEqual([state().state, state().cooldownSeconds], ["open", 120])
  tick(121); await breaker.admit({ owner: "a2", cfg }); await breaker.report({ owner: "a2", mode: "probe", ok: true, cfg }); tick(61)
  assert.deepEqual(await breaker.admit({ owner: "z", cfg }), { allowed: true, mode: "normal" }); assert.equal(state().state, "closed"); assert.equal(state().cooldownStep, 0)
  await failN(3); assert.equal(state().cooldownSeconds, 60) // a new incident starts at the bottom of the ladder again
})
test("cooldown ladder: the breaker config no longer has a cooldownSeconds knob (the ladder is fixed)", () => {
  assert.equal("cooldownSeconds" in cfgMod.DEFAULTS.luna.breaker, false)
  assert.ok(cfgMod.validateConfig(cfgMod.merge(cfgMod.DEFAULTS, { luna: { breaker: { cooldownSeconds: 10 } } })).length > 0)
})

test("FAIL CLOSED: report() retries once before it gives up (one transient failure leaves no hold)", async () => {
  const cfg = bcfg(); let n = 0; const restore = breakerTxFails(() => n++ < 1)
  const r = await breaker.report({ owner: "t", mode: "normal", ok: false, kind: "timeout", cfg }); restore(); assert.equal(r.reported, true); assert.equal(state().consecutive, 1)
})
test("FAIL CLOSED: report() never throws, whatever fails", async () => {
  const cfg = bcfg(); const real = env.db.runTransaction; env.db.runTransaction = async () => { throw new Error("boom") }; const rc = env.db.collection.bind(env.db); env.db.collection = () => { throw new Error("no db") }
  const r = await breaker.report({ owner: "t", mode: "normal", ok: false, kind: "timeout", cfg }); env.db.runTransaction = real; env.db.collection = rc; assert.equal(r.reported, false); assert.equal(r.event.kind, "timeout")
})

// ================================================================== ROUND 4: unresolved paid-call records, bounded fail-closed reconcile

const recs = () => env.list("ai-usage").filter((d) => d.id.startsWith("luna_r_"))
const unresolvedNow = () => recs().filter((d) => d.unresolved === true)
const ucfg = () => bcfg()
// A call that was committed `ageSeconds` ago and never settled (young = in flight, old = lost). Goes through the REAL begin().
let seq = 0
const makeCalled = async (ageSeconds, uid = `bu${++seq}`) => {
  const keep = env.time.now; env.time.now = keep - ageSeconds * 1000
  const t = await usage.begin({ uid, requestId: `req-bk-${seq}-${uid}`, cfg: ucfg(), reserveTokens: 600 }); env.time.now = keep; assert.equal(t.ok, true); return { uid, id: `req-bk-${seq}-${uid}` }
}
// A settled call whose breaker update was lost: the event rides on the record.
const makeEvent = async (ev, uid = `be${++seq}`) => {
  const c = await makeCalled(0, uid); const rec = recs().find((d) => d.uid === uid)
  env.seed(`ai-usage/${rec.id}`, { ...rec, state: "settled", outcome: ev.ok ? "ok" : ev.kind, pendingEvent: { owner: `o-${uid}`, mode: "normal", ok: false, kind: null, retryAfterSeconds: 0, rejected: false, overrun: false, epoch: 0, ...ev }, unresolved: true }); return c
}
const shardTokens = () => env.list("ai-usage").filter((d) => d.id.startsWith("luna_g_")).reduce((a, d) => a + d.tokens, 0)

test("UNRESOLVED: begin() commits unresolved:true, the committed timestamp and the epoch BEFORE any provider call; still no expireAt", async () => {
  await makeCalled(0); const r = recs()[0]; assert.equal(r.unresolved, true); assert.equal(r.state, "called"); assert.ok(r.calledAt && typeof r.calledAt.toMillis === "function"); assert.equal(r.epoch, 0); assert.equal("expireAt" in r, false)
})
test("UNRESOLVED grace: measured from the server-committed calledAt; 90 s is the last second a call counts as in flight", async () => {
  assert.equal(K.UNRESOLVED.graceMs, 90000)
  await makeCalled(10); await makeCalled(89); await makeCalled(90)
  assert.deepEqual(await breaker.admit({ owner: "a", cfg: ucfg() }), { allowed: true, mode: "normal" }); assert.equal(unresolvedNow().length, 3); assert.equal(state(), undefined) // nothing touched
  await makeCalled(91); const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.deepEqual([g.allowed, g.reason], [false, "open"]); assert.equal(unresolvedNow().length, 3) // only the stale one was resolved
})
test("UNRESOLVED grace: it exceeds the whole life of the invocation, not just the HTTP timeout (pinned to functions/index.js)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8")
  const m = [...src.matchAll(/timeoutSeconds\s*:\s*(\d+)/g)].map((x) => Number(x[1])); const fnTimeout = m.length ? Math.max(...m) : 60 // 2nd-gen callable default is 60 s
  assert.ok(fnTimeout <= K.FUNCTION_TIMEOUT_SECONDS, `index.js sets timeoutSeconds ${fnTimeout}: raise FUNCTION_TIMEOUT_SECONDS (and the grace) first`)
  assert.ok(K.UNRESOLVED.graceMs >= (K.FUNCTION_TIMEOUT_SECONDS + 30) * 1000); assert.ok(K.UNRESOLVED.graceMs > K.CEILINGS.timeoutMs * 10)
})
test("UNRESOLVED: a stale unknown outcome opens the breaker CONSERVATIVELY (ladder step 0), never hard-blocks; the permanent record and its budget stay", async () => {
  const c = await makeCalled(200); const tokensBefore = shardTokens()
  const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.deepEqual([g.allowed, g.reason], [false, "open"])
  assert.deepEqual([state().state, state().cooldownSeconds], ["open", 60]); assert.notEqual(state().state, "blocked")
  const r = recs()[0]; assert.equal("unresolved" in r, false); assert.equal(r.state, "unreported"); assert.equal(r.resolvedBy, "reconcile"); assert.equal(r.reserved, 600); assert.equal("expireAt" in r, false)
  assert.equal(shardTokens(), tokensBefore) // the reservation stays charged: conservative budget accounting
  assert.equal((await usage.begin({ uid: c.uid, requestId: c.id, cfg: ucfg(), reserveTokens: 600 })).reason, "request-seen") // the same uid+requestId can never be called again
  const g2 = await breaker.admit({ owner: "b", cfg: ucfg() }); assert.equal(g2.reason, "open"); assert.equal(recs().length, 1) // idempotent: nothing more happens
})
test("UNRESOLVED: a stale record does not change an already open/blocked breaker; epoch from before an operator reset is dropped", async () => {
  await breaker.report({ owner: "x", mode: "normal", ok: false, kind: "auth", cfg: ucfg() }); await makeCalled(200)
  assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).reason, "blocked"); assert.equal(state().blockedKind, "auth"); assert.equal(unresolvedNow().length, 0)
  await makeCalled(200); const reset = bcfg({ resetEpoch: 1 }); await breaker.admit({ owner: "r", cfg: reset }) // reset clears the block first? no: stale epoch-0 record is dropped, so the reset-cleared breaker stays closed
  assert.equal(unresolvedNow().length, 0)
})
test("UNRESOLVED: a stored pendingEvent is replayed exactly (a lost 'auth' blocks; a lost 'ok' changes nothing) and the record is resolved but kept", async () => {
  await makeEvent({ ok: false, kind: "auth" }); const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.deepEqual([g.allowed, g.reason], [false, "blocked"]); assert.equal(state().blockedKind, "auth")
  const r = recs()[0]; assert.equal("unresolved" in r, false); assert.equal("pendingEvent" in r, false); assert.equal(r.state, "settled"); assert.equal(r.outcome, "auth")
  env = F.setupWorld(); await makeEvent({ ok: true }); assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).allowed, true); assert.equal(state().state, "closed"); assert.equal(state().consecutive, 0); assert.equal(unresolvedNow().length, 0)
})
for (const n of [50, 51, 101, 120]) {
  test(`UNRESOLVED backlog of ${n}: all are replayed in bounded rounds; Luna is admitted only after NONE remain`, async () => {
    for (let i = 0; i < n; i++) await makeEvent({ ok: true }) // benign events: after a complete replay the breaker stays closed, so admission is the proof of completeness
    assert.equal(unresolvedNow().length, n); const g = await breaker.admit({ owner: "a", cfg: ucfg() })
    assert.deepEqual(g, { allowed: true, mode: "normal" }); assert.equal(unresolvedNow().length, 0); assert.equal(recs().length, n)
  })
}
test("UNRESOLVED backlog: beyond the bounded rounds (301 > 6 x 50) admit() DENIES and leaves the rest for the next attempt", async () => {
  for (let i = 0; i < 301; i++) await makeEvent({ ok: true }); const g = await breaker.admit({ owner: "a", cfg: ucfg() })
  assert.deepEqual([g.allowed, g.reason], [false, "unresolved-calls:backlog"]); assert.equal(unresolvedNow().length, 1)
  assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).allowed, true); assert.equal(unresolvedNow().length, 0) // the next attempt finishes the job
})
for (const [young, stale] of [[30, 90], [25, 100], [10, 101], [20, 120]]) { // a realistic ceiling for in-flight calls is 2 x 10 instances = 20
  test(`UNRESOLVED mixed backlog (${young} in flight + ${stale} stale): stale ones resolved, in-flight ones untouched, a young record is never swept`, async () => {
    for (let i = 0; i < young; i++) await makeCalled(5 + (i % 80)); for (let i = 0; i < stale; i++) await makeEvent({ ok: true })
    const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.deepEqual(g, { allowed: true, mode: "normal" })
    const left = unresolvedNow(); assert.equal(left.length, young); assert.ok(left.every((r) => r.state === "called" && !r.resolvedBy))
  })
}
test("UNRESOLVED starvation: more in-flight records than a page can hold (impossible under the concurrency caps) fails CLOSED, never open", async () => {
  for (let i = 0; i < 49; i++) await makeCalled(5 + i); for (let i = 0; i < 51; i++) await makeEvent({ ok: true })
  const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.equal(g.allowed, false); assert.match(g.reason, /^unresolved-calls:(backlog|incomplete)$/); assert.ok(unresolvedNow().filter((r) => r.state === "called").length === 49)
})
test("UNRESOLVED: a FULL page of in-flight records cannot prove there is nothing behind it, so admit() denies (fails closed)", async () => {
  for (let i = 0; i < 50; i++) await makeCalled(1); const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.deepEqual([g.allowed, g.reason], [false, "unresolved-calls:incomplete"])
  env = F.setupWorld(); for (let i = 0; i < 49; i++) await makeCalled(1); assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).allowed, true) // 49 < page: provably complete
})
test("UNRESOLVED failure injection: a failing chunk denies; earlier chunks stay resolved (atomic per chunk); the next attempt finishes", async () => {
  for (let i = 0; i < 45; i++) await makeEvent({ ok: true }); const real = env.db.runTransaction.bind(env.db); let n = 0
  env.db.runTransaction = async (fn) => { const readsToo = true; let touches = false; const probe = { get: async (r) => { if (readsToo && r.path === "ai-usage/luna-breaker") touches = true; return { exists: false, data: () => ({}) } }, set(r) { if (r.path === "ai-usage/luna-breaker") touches = true }, delete() {} }; try { await fn(probe) } catch (e) { } if (touches && ++n === 2) throw new Error("UNAVAILABLE"); return real(fn) }
  try { const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.deepEqual([g.allowed, g.reason], [false, "unresolved-calls:reconcile-failed"]) } finally { env.db.runTransaction = real }
  assert.equal(unresolvedNow().length, 25) // first chunk of 20 committed, nothing half-applied
  assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).allowed, true); assert.equal(unresolvedNow().length, 0)
})
test("UNRESOLVED failure injection: unreadable query, unreadable breaker, or a failing replay each DENY; nothing is admitted on any read/transaction failure", async () => {
  await makeEvent({ ok: true }); const realCol = env.db.collection.bind(env.db)
  env.db.collection = (n) => { const c = realCol(n); c.where = () => ({ limit: () => ({ get: async () => { throw new Error("query failed") } }) }); return c }
  try { assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).reason, "breaker-unreadable") } finally { env.db.collection = realCol }
  const restore = breakerTxFails(() => true, true); try { const g = await breaker.admit({ owner: "a", cfg: ucfg() }); assert.deepEqual([g.allowed, g.reason], [false, "unresolved-calls:reconcile-failed"]) } finally { restore() }
  const realGet = Object.getPrototypeOf(env.db.collection("ai-usage").doc("luna-breaker")).get; const P = Object.getPrototypeOf(env.db.collection("ai-usage").doc("luna-breaker"))
  P.get = async function () { if (this.path === "ai-usage/luna-breaker") throw new Error("breaker read failed"); return realGet.call(this) }
  try { assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).reason, "breaker-unreadable") } finally { P.get = realGet }
  assert.equal(unresolvedNow().length, 1) // nothing was resolved by the failed attempts
})
test("UNRESOLVED: the query and the breaker read are BOTH issued before either is awaited, and both must succeed", async () => {
  await makeCalled(1); const order = []; const realCol = env.db.collection.bind(env.db); const P = Object.getPrototypeOf(env.db.collection("ai-usage").doc("x")); const realGet = P.get
  env.db.collection = (n) => { const c = realCol(n); const w = c.where.bind(c); c.where = (...a) => { order.push("query-issued"); return w(...a) }; return c }
  P.get = async function () { if (this.path === "ai-usage/luna-breaker") order.push("breaker-issued"); return realGet.call(this) }
  try { await breaker.admit({ owner: "a", cfg: ucfg() }) } finally { env.db.collection = realCol; P.get = realGet }
  assert.deepEqual(order.slice(0, 2).sort(), ["breaker-issued", "query-issued"])
})
test("UNRESOLVED: concurrent reconcilers apply every stored event exactly once (atomic + idempotent)", async () => {
  await makeEvent({ ok: false, kind: "timeout", owner: "e1" }); await makeEvent({ ok: false, kind: "timeout", owner: "e2" })
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => breaker.admit({ owner: `c${i}`, cfg: ucfg() })))
  assert.ok(res.every((r) => r.allowed === true)); assert.equal(state().consecutive, 2, "applied twice would have been 4 and opened the breaker"); assert.equal(state().state, "closed"); assert.equal(unresolvedNow().length, 0)
  const rs = recs(); assert.ok(rs.every((r) => r.resolvedBy === "reconcile") && rs.length === 2)
})
test("UNRESOLVED: a stale record and a concurrent late settle cannot double count (settle sees state != called and does nothing)", async () => {
  const c = await makeCalled(200); const ticket = { day: recs()[0].day, shard: recs()[0].shard, reserved: 600 }
  await breaker.admit({ owner: "a", cfg: ucfg() }); const t0 = shardTokens()
  assert.equal(await usage.settleFailure({ uid: c.uid, requestId: c.id, ticket, kind: "timeout", usage: null }), false); assert.equal(shardTokens(), t0); assert.equal(recs()[0].state, "unreported")
})
test("UNRESOLVED: the unresolved query needs only the automatic single-field index (no composite index, no rules change)", () => {
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "security-rules", "firestore.indexes.json"), "utf8"))
  assert.deepEqual(idx.fieldOverrides, []) // no exemption disables the automatic index on `unresolved`
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "ai", "luna", "breaker.js"), "utf8"); const q = src.match(/where\("unresolved", "==", true\)([^\n]*)/)[1]
  assert.match(q, /^\.limit\(UNRESOLVED\.page\)\.get\(\)/); assert.ok(!/orderBy|where\(.*where\(/.test(q)) // one equality filter, no order, no range: single-field index only
})

// ================================================================== ROUND 5: lease / slot ownership, hard-block + reset-epoch protection, begin() guard
const outc = (owner, mode, ok, kind = "timeout", more = {}) => breaker.report({ owner, mode, ok, kind: ok ? undefined : kind, cfg: more.cfg || ucfg(), ...more })
const probeReplaced = async () => { await failN(3); tick(61); assert.equal((await breaker.admit({ owner: "A", cfg: ucfg() })).mode, "probe"); tick(31); assert.equal((await breaker.admit({ owner: "B", cfg: ucfg() })).mode, "probe"); assert.equal(state().lease.owner, "B") }
const inRecovery = async () => { await failN(3); tick(61); await breaker.admit({ owner: "p", cfg: ucfg() }); await outc("p", "probe", true); assert.equal(state().state, "recovery") }

test("PROBE OWNERSHIP: A's lease expired and B holds the new lease; A's late SUCCESS changes nothing and B stays the one probe", async () => {
  await probeReplaced(); const lease = JSON.stringify(state().lease); await outc("A", "probe", true); assert.equal(state().state, "half_open"); assert.equal(JSON.stringify(state().lease), lease)
  assert.deepEqual(await breaker.admit({ owner: "C", cfg: ucfg() }), { allowed: false, reason: "probe-in-progress" })
})
test("PROBE OWNERSHIP: A's late counted FAILURE does not wipe B's lease, re-open, or climb the ladder", async () => {
  await probeReplaced(); const step = state().cooldownStep; await outc("A", "probe", false, "timeout"); await outc("A", "probe", false, "server"); await outc("A", "probe", false, "rate_limit", { retryAfterSeconds: 500 })
  assert.deepEqual([state().state, state().lease.owner, state().cooldownStep], ["half_open", "B", step])
})
test("PROBE OWNERSHIP: B (the lease holder) still decides: success -> recovery, failure -> next ladder step", async () => {
  await probeReplaced(); await outc("A", "probe", true); await outc("B", "probe", true); assert.equal(state().state, "recovery")
  env = F.setupWorld(); await probeReplaced(); const s0 = state().cooldownStep; await outc("A", "probe", true); await outc("B", "probe", false, "timeout"); assert.deepEqual([state().state, state().cooldownStep], ["open", s0 + 1])
})
test("PROBE OWNERSHIP: an EXPIRED lease nobody replaced no longer authorises a state change (strict); the next admit simply takes a new lease", async () => {
  await failN(3); tick(61); await breaker.admit({ owner: "A", cfg: ucfg() }); tick(31); await outc("A", "probe", true); assert.equal(state().state, "half_open")
  assert.equal((await breaker.admit({ owner: "B", cfg: ucfg() })).mode, "probe")
})
test("PROBE OWNERSHIP: a late hard failure (auth/billing/bad_request) from a non-owner still BLOCKS (safe direction); a late probe success never un-blocks or moves open/closed", async () => {
  await probeReplaced(); await outc("A", "probe", false, "auth"); assert.deepEqual([state().state, state().blockedKind], ["blocked", "auth"])
  env = F.setupWorld(); await failN(3); await outc("A", "probe", true); assert.equal(state().state, "open") // open breaker: a late success does not skip the cooldown
  env = F.setupWorld(); await outc("A", "probe", true); await outc("A", "probe", false, "timeout"); assert.equal(state().state === undefined || state().state === "closed", true) // closed: success is bookkeeping, failure counts as ONE ordinary failure
  assert.equal(state().consecutive, 1)
})

test("RECOVERY OWNERSHIP: the reporting owner must hold an UNEXPIRED recovery slot to change state", async () => {
  await inRecovery(); await breaker.admit({ owner: "x", cfg: ucfg() }); assert.ok(state().inflight.x > env.time.now)
  await outc("x", "recovery", false, "timeout"); assert.equal(state().state, "open") // holder: failure re-opens
  env = F.setupWorld(); await inRecovery(); await breaker.admit({ owner: "x", cfg: ucfg() }); tick(31) // expired slot (entry still stored, but no longer live)
  await outc("x", "recovery", false, "timeout"); assert.equal(state().state, "recovery"); assert.ok(state().inflight.x, "a non-owner outcome must not even remove the entry") // ignored
  await outc("x", "recovery", true); assert.equal(state().state, "recovery")
})
test("RECOVERY OWNERSHIP: a replaced slot (expired, purged by later admissions) cannot change state; the new holder can", async () => {
  await inRecovery(); const c = ucfg(); await breaker.admit({ owner: "x", cfg: c }); await breaker.admit({ owner: "y", cfg: c }); tick(31)
  assert.equal((await breaker.admit({ owner: "z", cfg: c })).mode, "recovery"); assert.deepEqual(Object.keys(state().inflight), ["z"]) // x and y purged, z holds the only live slot
  await outc("x", "recovery", false, "server"); await outc("y", "recovery", false, "timeout"); assert.equal(state().state, "recovery")
  await outc("z", "recovery", false, "timeout"); assert.equal(state().state, "open")
})
test("RECOVERY OWNERSHIP: a delayed failure after the breaker moved on is ignored (open), counts once (closed), and blocks only for hard kinds", async () => {
  await inRecovery(); const c = ucfg(); await breaker.admit({ owner: "x", cfg: c }); await breaker.admit({ owner: "y", cfg: c }); await outc("y", "recovery", false, "timeout"); const secs = state().cooldownSeconds; assert.equal(state().state, "open")
  await outc("x", "recovery", false, "timeout"); assert.deepEqual([state().state, state().cooldownSeconds], ["open", secs]) // not a second ladder step
  env = F.setupWorld(); await inRecovery(); await breaker.admit({ owner: "x", cfg: c }); tick(61); assert.deepEqual(await breaker.admit({ owner: "n", cfg: c }), { allowed: true, mode: "normal" }); assert.equal(state().state, "closed")
  await outc("x", "recovery", false, "timeout"); assert.deepEqual([state().state, state().consecutive], ["closed", 1])
  await outc("x", "recovery", false, "billing"); assert.equal(state().state, "blocked")
})
test("RECOVERY OWNERSHIP: concurrent recovery calls never exceed the global cap of 2, and concurrent outcomes resolve consistently", async () => {
  await inRecovery(); const c = ucfg(); const got = await Promise.all(["w", "x", "y", "z"].map((o) => breaker.admit({ owner: o, cfg: c }))); const held = ["w", "x", "y", "z"].filter((_, i) => got[i].allowed)
  assert.equal(held.length, 2); assert.equal(Object.keys(state().inflight).length, 2); const other = ["w", "x", "y", "z"].filter((o) => !held.includes(o))[0]
  assert.equal((await breaker.admit({ owner: other, cfg: c })).allowed, false)
  await Promise.all([outc(held[0], "recovery", true), outc(held[1], "recovery", false, "timeout")]); assert.equal(state().state, "open"); assert.deepEqual(state().inflight, {}) // either order ends open
  await outc(held[0], "recovery", true); assert.equal(state().state, "open") // and the straggler cannot move it
})
test("RECOVERY OWNERSHIP: a holder's success frees only its own slot", async () => {
  await inRecovery(); const c = ucfg(); await breaker.admit({ owner: "x", cfg: c }); await breaker.admit({ owner: "y", cfg: c }); await outc("x", "recovery", true)
  assert.deepEqual(Object.keys(state().inflight), ["y"]); assert.equal((await breaker.admit({ owner: "w", cfg: c })).mode, "recovery"); assert.equal(Object.keys(state().inflight).length, 2)
})

const snapshotOf = () => JSON.stringify(state())
test("HARD BLOCK: no late event of ANY kind, mode or age can clear a blocked breaker; only an operator reset can", async () => {
  await outc("x", "normal", false, "billing"); assert.equal(state().state, "blocked"); const before = snapshotOf()
  for (const mode of ["normal", "probe", "recovery"]) for (const [ok, kind, more] of [[true], [true, "", { rejected: true }], [true, "", { overrun: true }], [false, "timeout"], [false, "server"], [false, "rate_limit"], [false, "unreported"], [false, "billing"], [false, "auth"], [false, "bad_request"]]) {
    await outc("late", mode, ok, kind, more || {}); assert.equal(snapshotOf(), before, `${mode} ${ok} ${kind}`)
  }
  tick(10000000); assert.deepEqual(await breaker.admit({ owner: "q", cfg: ucfg() }), { allowed: false, reason: "blocked" })
  assert.deepEqual(await breaker.admit({ owner: "q", cfg: bcfg({ resetEpoch: 1 }) }), { allowed: true, mode: "normal" }); assert.equal(state().state, "closed")
})
test("RESET EPOCH: an event from before the operator reset can never re-block, re-open or count after it; a post-reset event still does", async () => {
  await outc("x", "normal", false, "auth"); const reset = bcfg({ resetEpoch: 1 }); await breaker.admit({ owner: "op", cfg: reset }); assert.deepEqual([state().state, state().resetEpoch], ["closed", 1])
  await outc("late", "normal", false, "auth"); assert.equal(state().state, "closed") // reporter still on epoch 0 (stale config cache)
  await outc("late", "probe", false, "billing"); await outc("late", "recovery", false, "bad_request"); for (let i = 0; i < 5; i++) await outc(`l${i}`, "normal", false, "timeout")
  assert.deepEqual([state().state, state().consecutive], ["closed", 0])
  await outc("fresh", "normal", false, "auth", { cfg: reset }); assert.equal(state().state, "blocked") // a genuinely new failure still blocks
})
test("RESET EPOCH: the breaker document's epoch is a floor too, even if the reporting instance has not seen the new config", async () => {
  await outc("x", "normal", false, "auth"); await breaker.admit({ owner: "op", cfg: bcfg({ resetEpoch: 2 }) }); assert.equal(state().resetEpoch, 2)
  await outc("late", "normal", false, "auth", { cfg: bcfg({ resetEpoch: 1 }) }); assert.equal(state().state, "closed") // 1 < document epoch 2
  const next = breaker.reduce(state(), { owner: "o", mode: "normal", ok: false, kind: "auth", epoch: 0 }, bcfg({ resetEpoch: 2 }), env.time.now); assert.equal(next, null)
})
test("RECONCILE + RESET EPOCH: replayed events from an earlier epoch are resolved but never applied; current-epoch events are", async () => {
  await outc("x", "normal", false, "auth"); await breaker.admit({ owner: "op", cfg: bcfg({ resetEpoch: 1 }) }); assert.equal(state().state, "closed")
  await makeEvent({ ok: false, kind: "auth", epoch: 0 }); await makeCalled(200) // a stale epoch-0 call too (begin recorded epoch 0)
  const g = await breaker.admit({ owner: "a", cfg: bcfg({ resetEpoch: 1 }) }); assert.deepEqual(g, { allowed: true, mode: "normal" }); assert.equal(state().state, "closed"); assert.equal(unresolvedNow().length, 0); assert.equal(recs().length, 2) // resolved, kept
  const c1 = bcfg({ resetEpoch: 1 }); const keep = env.time.now; const t = await usage.begin({ uid: "e1", requestId: "req-e1-0001", cfg: c1, reserveTokens: 600 }); assert.equal(t.ok, true); assert.equal(recs().find((r) => r.uid === "e1").epoch, 1)
  await makeEvent({ ok: false, kind: "auth", epoch: 1 }); assert.deepEqual((await breaker.admit({ owner: "b", cfg: c1 })).reason, "blocked"); assert.ok(keep)
})
test("RECONCILE: a stored event can never clear a block, and a stored probe/recovery event follows the same ownership rules", async () => {
  await outc("x", "normal", false, "auth"); await makeEvent({ ok: true, mode: "probe" }); await makeEvent({ ok: false, kind: "timeout", mode: "recovery" })
  assert.equal((await breaker.admit({ owner: "a", cfg: ucfg() })).reason, "blocked"); assert.equal(state().blockedKind, "auth"); assert.equal(unresolvedNow().length, 0)
  env = F.setupWorld(); await probeReplaced() // B holds the lease; A's stored probe failure is replayed
  await makeEvent({ ok: false, kind: "timeout", mode: "probe", owner: "A" }); const g = await breaker.admit({ owner: "c", cfg: ucfg() }); assert.equal(g.reason, "probe-in-progress"); assert.deepEqual([state().state, state().lease.owner], ["half_open", "B"]); assert.equal(unresolvedNow().length, 0)
  env = F.setupWorld(); await failN(3); tick(61); await breaker.admit({ owner: "A", cfg: ucfg() }) // A still holds the live lease: its stored failure applies
  await makeEvent({ ok: false, kind: "timeout", mode: "probe", owner: "A" }); assert.equal((await breaker.admit({ owner: "c", cfg: ucfg() })).reason, "open"); assert.equal(unresolvedNow().length, 0)
})

test("GUARD: guardInTx allows only a closed breaker (normal), the live lease owner (probe), or a live slot holder (recovery); blocked always denies", async () => {
  const g = (owner, mode) => env.db.runTransaction((tx) => breaker.guardInTx(tx, { owner, mode, cfg: ucfg() }))
  assert.deepEqual(await g("a", "normal"), { ok: true }); assert.equal((await g("a", "probe")).ok, false); assert.equal((await g("a", "recovery")).ok, false)
  await failN(3); assert.equal((await g("a", "normal")).ok, false); tick(61); await breaker.admit({ owner: "A", cfg: ucfg() })
  assert.equal((await g("A", "probe")).ok, true); assert.equal((await g("B", "probe")).ok, false); tick(31); assert.equal((await g("A", "probe")).ok, false) // expired
  env = F.setupWorld(); await inRecovery(); await breaker.admit({ owner: "x", cfg: ucfg() }); assert.equal((await g("x", "recovery")).ok, true); assert.equal((await g("y", "recovery")).ok, false); assert.equal((await g("x", "normal")).ok, false); tick(31); assert.equal((await g("x", "recovery")).ok, false)
  env = F.setupWorld(); await outc("x", "normal", false, "auth"); for (const m of ["normal", "probe", "recovery"]) assert.deepEqual(await g("x", m), { ok: false, reason: "breaker-blocked" })
})
test("GUARD: a denying guard makes begin() commit NOTHING (no record, no attempt, no reservation) and does not try other shards", async () => {
  const r = await usage.begin({ uid: "g1", requestId: "req-g1-0001", cfg: ucfg(), reserveTokens: 600, guard: async () => ({ ok: false, reason: "breaker-changed" }) })
  assert.deepEqual([r.ok, r.reason], [false, "breaker-changed"]); assert.equal(env.list("ai-usage").length, 0)
  const ok = await usage.begin({ uid: "g1", requestId: "req-g1-0001", cfg: ucfg(), reserveTokens: 600, guard: async () => ({ ok: true }) }); assert.equal(ok.ok, true); assert.equal(recs().length, 1) // the same requestId is still usable: nothing was burnt
})

// ================================================================== ROUND 6: late successes and consecutive failures; reset epoch at the commit point
test("LATE SUCCESS: two counted failures, then a success from a request that STARTED BEFORE them, then a third failure -> the breaker opens (the older success erased nothing)", async () => {
  const t0 = env.time.now; tick(1)
  await outc("f1", "normal", false, "timeout"); tick(1); await outc("f2", "normal", false, "timeout"); assert.equal(state().consecutive, 2)
  await outc("old", "normal", true, undefined, { startedAt: t0 }); assert.equal(state().consecutive, 2); assert.equal(state().state, "closed") // the older answer is not evidence about NOW
  await outc("f3", "normal", false, "timeout"); assert.equal(state().state, "open")
})
test("LATE SUCCESS: a success from a request that started AFTER the failures still ends the consecutive run (legitimate reset preserved); so does one with no start time", async () => {
  await outc("f1", "normal", false, "timeout"); tick(1); await outc("f2", "normal", false, "timeout"); tick(1)
  await outc("new", "normal", true, undefined, { startedAt: env.time.now }); assert.equal(state().consecutive, 0)
  await outc("f3", "normal", false, "timeout"); assert.equal(state().state, "closed") // 1 consecutive, 3 in the window but under the 5 threshold
  await outc("f4", "normal", false, "timeout"); await outc("legacy", "normal", true); assert.equal(state().consecutive, 0)
})
test("LATE SUCCESS: an older success still does its bookkeeping: rejected outputs enter the ring and input overruns count, while the failure run is untouched", async () => {
  const t0 = env.time.now; tick(1); await outc("f1", "normal", false, "timeout"); tick(1); await outc("f2", "normal", false, "timeout")
  await outc("o1", "normal", true, undefined, { startedAt: t0, rejected: true, overrun: true })
  assert.deepEqual([state().consecutive, state().overruns, state().invalid.length], [2, 1, 1])
  await outc("o2", "normal", true, undefined, { startedAt: t0, overrun: true }); await outc("o3", "normal", true, undefined, { startedAt: t0, overrun: true }); assert.equal(state().state, "blocked"); assert.equal(state().blockedKind, "input_overrun") // thresholds unchanged
})
test("LATE SUCCESS: 8 rejected among the last 10 still opens the breaker for 900 s when the answers are older than the failures", async () => {
  const t0 = env.time.now; tick(1); await outc("f1", "normal", false, "timeout"); tick(1)
  for (let i = 0; i < 8; i++) await outc(`r${i}`, "normal", true, undefined, { startedAt: t0, rejected: true })
  assert.equal(state().state, "open"); assert.equal(state().cooldownSeconds, 900)
})
test("EPOCH GUARD: guardInTx refuses a configuration whose resetEpoch is older than the breaker document's (normal, probe and recovery), and accepts an equal or newer one", async () => {
  const g = (owner, mode, epoch) => env.db.runTransaction((tx) => breaker.guardInTx(tx, { owner, mode, cfg: cfgWith({ resetEpoch: epoch }) }))
  env.seed("ai-usage/luna-breaker", { ...breaker.closed(1) })
  assert.deepEqual(await g("o", "normal", 0), { ok: false, reason: "config-stale" }); assert.deepEqual(await g("o", "normal", 1), { ok: true }); assert.deepEqual(await g("o", "normal", 2), { ok: true })
  env.seed("ai-usage/luna-breaker", { ...breaker.closed(1), state: "half_open", lease: { owner: "o", expiresAt: env.time.now + 30000 } })
  assert.equal((await g("o", "probe", 0)).reason, "config-stale"); assert.equal((await g("o", "probe", 1)).ok, true)
  env.seed("ai-usage/luna-breaker", { ...breaker.closed(1), state: "recovery", recoveryUntil: env.time.now + 600000, inflight: { o: env.time.now + 30000 } })
  assert.equal((await g("o", "recovery", 0)).reason, "config-stale"); assert.equal((await g("o", "recovery", 1)).ok, true)
})
