"use strict"
// Luna wording layer end to end through the REAL aiChat / consent / usage / admin handlers. The provider is a MOCK: no network, no key, no paid call.
const { test, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const F = require("./engine_fixture")
const { req, rejects, makeSuperAdmin } = require("./helpers")
const H = require("../src/handlers/ai")
const conv = require("../src/ai/conversations")
const luna = require("../src/ai/luna")
const usage = require("../src/ai/luna/usage")
const prompt = require("../src/ai/luna/prompt")
const cfgMod = require("../src/ai/config")

const THANKS = "You're welcome! Ask me anything else about Soweto."
const REWRITE = "Anytime! Feel free to ask me anything else about Soweto."
const U = { input: 400, output: 30, cached: 0, reasoning: 0 }
const manifest = () => ({ status: "calibrated", reasoningEffort: "none", payloads: Object.fromEntries(prompt.allPayloads().map((p) => [p.id, { sha256: p.sha256, inputTokens: 400 }])) })
const goodOut = (all = REWRITE) => ({ ok: true, text: JSON.stringify({ segments: { all } }), usage: U, ms: 5 })

let env, n = 0, calls, provider
const rid = () => `req-${++n}-${Math.random().toString(36).slice(2, 8)}`
const install = (fn, over = {}) => { provider = fn; luna.setDepsForTests({ manifest: manifest(), hasKey: () => true, callResponses: async (a) => { calls.push({ ...a, dbAtCall: snapshotAtCall() }); return provider(a) }, ...over }) }
const snapshotAtCall = () => ({ requests: env.list("ai-usage").filter((d) => d.id.startsWith("luna_r_")).map((d) => ({ state: d.state, reserved: d.reserved })), shardTokens: env.list("ai-usage").filter((d) => d.id.startsWith("luna_g_")).reduce((a, d) => a + d.tokens, 0) })
const enable = (over = {}) => env.seed("ai-config/default", { luna: { enabled: true, ...over } })
const accept = (uid = "u1") => H.aiSetLunaConsent(req(uid, { action: "accept", noticeVersion: 1 }))
const chat = (uid, message, extra = {}) => H.aiChat(req(uid, { message, requestId: rid(), aiNoticeVersion: 1, ...extra }))
const chatT = (u, m, e) => { env.time.now += 13000; return chat(u, m, e) } // 13 s apart: stays under Malloya's own 5/min burst limit
const textOf = (r) => r.blocks.map((b) => b.text).join("")
const lunaUser = (uid = "u1") => env.list("ai-usage").find((d) => d.id.startsWith(`luna_u_${uid}_`))
const shardTotal = () => snapshotAtCall().shardTokens
beforeEach(() => { env = F.setupWorld(); require("../src/ai/luna/breaker").resetLocalForTests(); calls = []; install(async () => goodOut()); enable() })
afterEach(() => luna.setDepsForTests({}))

// ------------------------------------------------------------------ the happy path
test("consented user, calibrated payload: a thanks is reworded; facts, pinned text and the response shape are untouched; usage commits with the turn", async () => {
  await accept(); const r = await chat("u1", "thanks!")
  assert.equal(textOf(r), REWRITE); assert.equal(calls.length, 1)
  assert.deepEqual(r.blocks.map((b) => b.type), ["verified"]); assert.equal(r.engine, "database-v1")
  assert.doesNotMatch(JSON.stringify(r), /luna|openai|token|rewrit|gpt/i) // no label, no provider or token field in anything the app receives
  const u = lunaUser(); assert.deepEqual([u.attempts, u.successes, u.inputTokens, u.outputTokens], [1, 1, 400, 30]); assert.equal(shardTotal(), 430) // reservation trued-up to actual
  assert.equal(env.list("ai-usage").find((d) => d.id.startsWith("luna_r_")).state, "settled")
  const msgs = env.list(`ai-conversations/${r.conversationId}/messages`); assert.equal(msgs.find((m) => m.role === "assistant").blocks[0].text, REWRITE) // what the user saw is what is stored
  const regular = await H.aiGetUsage(req("u1", {})); assert.equal(regular.usedToday, 1) // the normal 50/day message limit is unaffected by Luna
})
test("the greeting keeps its pinned capability sentence byte-for-byte; only the opener and the question may change", async () => {
  install(async () => ({ ok: true, text: JSON.stringify({ segments: { open: "Hello and welcome!", ask: "How can I help you today?" } }), usage: U, ms: 1 })); await accept()
  const r = await chat("u1", "hello"); const pinned = prompt.TEMPLATES.greeting.segments[1].text
  assert.equal(textOf(r), `Hello and welcome!${pinned}How can I help you today?`); assert.ok(textOf(r).includes(pinned))
  assert.deepEqual(r.followUps, (await (async () => { luna.setDepsForTests({}); return chat("u2", "hello") })()).followUps) // follow-ups come from Malloya, unchanged
})
test("what is sent to Luna: fixed instructions plus fixed template phrases ONLY; never the user's message, ids, or anything stored", async () => {
  await accept("uid-secret-123"); const msg = "thanks, my email is jane@example.com and my number is 0821234567"
  await chat("uid-secret-123", msg, { location: { latitude: -26.25, longitude: 27.9 } })
  const sent = JSON.stringify(calls[0].payload); assert.equal(calls.length, 1)
  for (const leak of ["jane", "example.com", "0821234567", "uid-secret-123", "-26.25", "27.9", "requestId", "conversationId", "req-"]) assert.ok(!sent.includes(leak), leak)
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ["bytes", "id", "input", "instructions", "language", "original", "schema", "sha256", "templateId", "withinByteCeiling"])
  assert.equal(JSON.parse(calls[0].payload.input).segments.all, THANKS)
  assert.equal(calls[0].maxOutputTokens, 500); assert.equal(calls[0].reasoningEffort, "none"); assert.ok(calls[0].timeoutMs <= 15000)
})
test("THE CRASH RULE: the 'called' record and the maximum reservation are committed BEFORE the provider request starts", async () => {
  await accept(); await chat("u1", "thanks")
  assert.deepEqual(calls[0].dbAtCall.requests, [{ state: "called", reserved: 900 }]) // 400 calibrated input + 500 max output
  assert.equal(calls[0].dbAtCall.shardTokens, 900)
})

// ------------------------------------------------------------------ every way Luna is OFF leaves Malloya exactly as it was
const expectDeterministic = async (label, run, expectCalls = 0) => { const r = await run(); assert.equal(textOf(r), THANKS, label); assert.equal(calls.length, expectCalls, label); return r }
test("fallbacks: disabled, old client, wrong notice version, no consent, withdrawn, stale consent, uncalibrated, hash drift, no key, isiZulu, other intents", async () => {
  await accept("c1")
  env.seed("ai-config/default", { luna: { enabled: false } }); await expectDeterministic("kill switch", () => chatT("c1", "thanks")); enable()
  await expectDeterministic("old client without aiNoticeVersion", () => { env.time.now += 13000; return H.aiChat(req("c1", { message: "thanks", requestId: rid() })) })
  for (const v of [0, 2, "1", null]) await expectDeterministic(`notice version ${v}`, () => chatT("c1", "thanks", { aiNoticeVersion: v }))
  await expectDeterministic("no consent recorded", () => chatT("nobody", "thanks"))
  env.seed("ai-consent/stale", { uid: "stale", active: true, noticeVersion: 0 }); await expectDeterministic("consent for an older notice", () => chatT("stale", "thanks"))
  await accept("w1"); await H.aiSetLunaConsent(req("w1", { action: "withdraw" })); await expectDeterministic("withdrawn", () => chatT("w1", "thanks"))
  install(async () => goodOut(), { manifest: { ...manifest(), status: "uncalibrated" } }); await expectDeterministic("uncalibrated", () => chatT("c1", "thanks"))
  const m = manifest(); m.payloads["thanks:en"].sha256 = "f".repeat(64); install(async () => goodOut(), { manifest: m }); await expectDeterministic("template changed since calibration", () => chatT("c1", "thanks"))
  const big = manifest(); big.payloads["thanks:en"].inputTokens = 3001; install(async () => goodOut(), { manifest: big }); await expectDeterministic("over the 3,000-token limit", () => chatT("c1", "thanks"))
  install(async () => goodOut(), { hasKey: () => false }); await expectDeterministic("no API key", () => chatT("c1", "thanks"))
  install(async () => goodOut())
  const zu = await chatT("c1", "ngiyabonga"); assert.equal(calls.length, 0); assert.equal(zu.detectedLanguage, "zu"); assert.match(zu.languageNotice, /isiZulu/)
  const find = await chatT("c1", "Where can I eat kota in Orlando West?"); assert.equal(calls.length, 0); assert.ok(find.cards.length > 0)
  const help = await chatT("c1", "help"); assert.equal(calls.length, 0) // capability text is never rewritable
})
test("the committed (uncalibrated) manifest keeps Luna OFF in a real runtime: nothing reaches the network", async () => {
  luna.setDepsForTests({}); const realFetch = globalThis.fetch; let touched = 0; globalThis.fetch = () => { touched++; throw new Error("network must not be used") }
  const prev = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key-not-real"
  try { await accept(); const r = await chat("u1", "thanks"); assert.equal(textOf(r), THANKS); assert.equal(touched, 0) } finally { globalThis.fetch = realFetch; if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev }
})
test("provider failures of every kind: the user still gets Malloya's answer; no success is counted; tokens and the breaker follow the failure kind", async () => {
  const expect = { rate_limit: [0, "open"], billing: [0, "blocked"], auth: [0, "blocked"], bad_request: [0, "blocked"], server: [900, "closed"], timeout: [900, "closed"], network: [900, "closed"] }
  for (const [kind, [charged, breakerState]] of Object.entries(expect)) {
    env.seed("ai-usage/luna-breaker", { state: "closed", failures: [], resetEpoch: 0 }); const uid = `f_${kind}`; await accept(uid); const before = shardTotal()
    install(async () => ({ ok: false, kind, ms: 3 })); const r = await chat(uid, "thanks"); assert.equal(textOf(r), THANKS, kind)
    assert.equal(shardTotal() - before, charged, `${kind} tokens`); assert.equal(lunaUser(uid).successes, 0, kind); assert.equal(lunaUser(uid).attempts, 1, kind)
    assert.equal(env.get("ai-usage/luna-breaker").state, breakerState, `${kind} breaker`)
  }
})
test("an invalid / risky rewrite is refused: original wording, tokens charged as reported, no success counted, provider healthy", async () => {
  await accept(); for (const bad of ["Thanks! Visit Maponya Mall, R80 entry.", "You're welcome! I will book it for you.", "x"]) {
    install(async () => goodOut(bad)); const r = await chat("u1", "thanks"); assert.equal(textOf(r), THANKS, bad)
  }
  const u = lunaUser(); assert.deepEqual([u.attempts, u.successes, u.inputTokens, u.outputTokens], [3, 0, 1200, 90]); assert.equal(env.get("ai-usage/luna-breaker").state, "closed"); assert.deepEqual(env.get("ai-usage/luna-breaker").invalid, [1, 1, 1]) // provider healthy; rejections are only counted
  install(async () => ({ ok: true, text: "not json", usage: U, ms: 1 })); assert.equal(textOf(await chat("u1", "thanks")), THANKS)
})
test("a provider that throws, or a response without usage, can never break the chat", async () => {
  await accept(); install(async () => { throw new Error("boom with key test-key-not-real") }); assert.equal(textOf(await chat("u1", "thanks")), THANKS)
  assert.ok(!JSON.stringify(env.logs).includes("test-key-not-real"))
  install(async () => ({ ok: true, text: JSON.stringify({ segments: { all: REWRITE } }), usage: null, ms: 1 })); assert.equal(textOf(await chat("u1", "thanks")), REWRITE) // no usage reported: the full reservation (900) is charged
  assert.equal(env.get(`ai-usage/${env.list("ai-usage").filter((d) => d.id.startsWith("luna_r_")).pop().id}`).actual >= 0, true)
})

// ------------------------------------------------------------------ limits are separate from Malloya's own, and never refuse a valid request
test("10 successful Luna answers per user per day; the 11th is deterministic and ordinary messages are not refused", async () => {
  await accept(); for (let i = 0; i < 10; i++) { assert.equal(textOf(await chat("u1", "thanks", {})), REWRITE, `call ${i + 1}`); env.time.now += 13000 } // stay under the 5/min message burst
  assert.equal(calls.length, 10); const eleventh = await chat("u1", "thanks"); assert.equal(textOf(eleventh), THANKS); assert.equal(calls.length, 10)
  assert.equal(lunaUser().successes, 10); assert.equal((await H.aiGetUsage(req("u1", {}))).luna.remainingToday, 0)
  env.time.now += 24 * 3600000; assert.equal(textOf(await chat("u1", "thanks")), REWRITE) // a new day (SAST) resets it
})
test("25 provider attempts per day: failures use attempts but never the 10 successes, and the cap holds", async () => {
  await accept(); enable({ limits: { dailySuccessPerUser: 2, dailyAttemptsPerUser: 3 } }); install(async () => ({ ok: false, kind: "server", ms: 1 }), {}); env.seed("ai-usage/luna-breaker", { state: "closed", failures: [] })
  for (let i = 0; i < 6; i++) { await chat("u1", "thanks"); env.time.now += 13000; env.seed("ai-usage/luna-breaker", { state: "closed", failures: [] }) }
  assert.equal(calls.length, 3); assert.equal(lunaUser().attempts, 3); assert.equal(lunaUser().successes, 0)
})
test("Malloya's own 50/day and 5/min limits behave exactly as before (Luna never changes them)", async () => {
  await accept(); for (let i = 0; i < 5; i++) await chat("u1", "thanks"); await rejects(chat("u1", "thanks"), "resource-exhausted", "rate-limited")
})

// ------------------------------------------------------------------ idempotency and crash recovery: never a second paid call for one requestId
test("a repeated requestId returns the stored answer and makes NO second provider call", async () => {
  await accept(); const id = rid(); const a = await chat("u1", "thanks", { requestId: id }), b = await chat("u1", "thanks", { requestId: id })
  assert.equal(calls.length, 1); assert.equal(textOf(a), textOf(b)); assert.equal(b.duplicate, true); assert.equal(lunaUser().attempts, 1)
})
test("crash after the 'called' commit: the retry gets the deterministic answer and the provider is NEVER called again", async () => {
  await accept(); const id = rid(); const t = await usage.begin({ uid: "u1", requestId: id, cfg: cfgMod.merge(cfgMod.DEFAULTS, { luna: { enabled: true } }), reserveTokens: 900 }); assert.equal(t.ok, true)
  const r = await chat("u1", "thanks", { requestId: id }); assert.equal(textOf(r), THANKS); assert.equal(calls.length, 0) // a record already exists for this requestId
  assert.equal(shardTotal(), 900) // the unsettled reservation stays counted (bounded, conservative): no leak, no double reservation
})
test("HARD CRASH: the process dies right after the 'called' commit (the settle also never happens); the retry gets Malloya's answer and the provider is not called again", async () => {
  await accept(); const id = rid(); const realTx = env.db.runTransaction.bind(env.db); let begun = false
  install(async () => { throw new Error("process killed while the provider call was in flight") })
  env.db.runTransaction = async (fn) => { if (begun) throw Object.assign(new Error("process is gone"), { code: 14 }); const r = await realTx(fn); if (env.list("ai-usage").some((d) => d.id.startsWith("luna_r_"))) begun = true; return r }
  const first = await chat("u1", "thanks", { requestId: id }).catch((e) => e) // whatever happens to the dying request is irrelevant; what matters is the durable state
  env.db.runTransaction = realTx
  assert.equal(calls.length, 1); const rec = env.list("ai-usage").find((d) => d.id.startsWith("luna_r_")); assert.equal(rec.state, "called"); assert.equal(rec.reserved, 900) // committed, never settled
  install(async () => goodOut()); env.time.now += 13000
  await rejects(chat("u1", "thanks", { requestId: id }), "aborted", "request-in-progress"); assert.equal(calls.length, 1) // Malloya's own in-flight marker (killed with the process) still protects the first 120 s
  env.time.now += 130000 // the in-flight marker is now stale, so Malloya runs the request again... and Luna must NOT
  const retry = await chat("u1", "thanks", { requestId: id }); assert.equal(textOf(retry), THANKS); assert.equal(calls.length, 1) // NO second provider call
  env.time.now += 3600000; await chat("u1", "thanks", { requestId: id }); assert.equal(calls.length, 1) // nor any later retry of the same requestId
  assert.equal(shardTotal(), 900) // the unsettled reservation remains counted: bounded and conservative
})
test("a failed first attempt is never retried for the same requestId either", async () => {
  await accept(); install(async () => ({ ok: false, kind: "timeout", ms: 1 })); const id = rid()
  await chat("u1", "thanks", { requestId: id }); install(async () => goodOut()); env.seed("ai-usage/luna-breaker", { state: "closed", failures: [] })
  // the first attempt stored its (deterministic) reply, so the retry is served from storage; even without it the request record blocks a second call
  const again = await chat("u1", "thanks", { requestId: id }); assert.equal(textOf(again), THANKS); assert.equal(calls.length, 1)
})
test("if the conversation write fails after a successful provider call, the user is not charged a success and a retry cannot call the provider again", async () => {
  await accept(); const real = conv.persistTurn; let fail = true; conv.persistTurn = async (a) => { if (fail) { fail = false; throw new Error("firestore down") } return real(a) }
  const id = rid()
  try {
    await rejects(chat("u1", "thanks", { requestId: id }), "internal", "ai-failed"); assert.equal(lunaUser().successes, 0); assert.equal(calls.length, 1)
    const retry = await chat("u1", "thanks", { requestId: id }); assert.equal(textOf(retry), THANKS); assert.equal(calls.length, 1) // the paid call is not repeated
  } finally { conv.persistTurn = real }
})
test("usage hooks inside persistTurn: a duplicate turn or an already-settled request never counts twice", async () => {
  await accept(); const id = rid(); const r = await chat("u1", "thanks", { requestId: id }); const before = JSON.stringify(lunaUser())
  const t = { day: lunaUser().day, shard: env.list("ai-usage").find((d) => d.id.startsWith("luna_r_")).shard, reserved: 900 }
  const hooks = usage.prepareSuccess({ uid: "u1", requestId: id, ticket: t, usage: U })
  const wrote = await env.db.runTransaction(async (tx) => { await hooks.read(tx); return hooks.write(tx) }); assert.equal(wrote, false)
  const dup = await conv.persistTurn({ uid: "u1", cid: r.conversationId, requestId: id, userText: "thanks", assistant: { blocks: [], language: "en" }, context: null, cfg: cfgMod.DEFAULTS, luna: usage.prepareSuccess({ uid: "u1", requestId: id, ticket: t, usage: U }) })
  assert.equal(dup.duplicate, true); assert.equal(JSON.stringify(lunaUser()), before.replace(/"updatedAt":[^,}]*,?/g, "").length ? JSON.stringify(lunaUser()) : before); assert.equal(lunaUser().successes, 1)
})

// ------------------------------------------------------------------ concurrency
test("per-instance concurrency is enforced: at most N provider calls in flight; extra requests are answered deterministically; the counter returns to zero", async () => {
  await accept("c1"); await accept("c2"); await accept("c3"); enable({ limits: { maxConcurrentPerInstance: 2 } })
  let release; const gate = new Promise((r) => { release = r }); let inFlight = 0, peak = 0
  install(async () => { inFlight++; peak = Math.max(peak, inFlight); await gate; inFlight--; return goodOut() })
  const all = Promise.all(["c1", "c2", "c3"].map((u) => chat(u, "thanks"))); await new Promise((r) => setTimeout(r, 50)); assert.equal(luna.inflightNow(), 2); release()
  const rs = await all; assert.equal(peak, 2); assert.equal(rs.filter((r) => textOf(r) === REWRITE).length, 2); assert.equal(rs.filter((r) => textOf(r) === THANKS).length, 1); assert.equal(luna.inflightNow(), 0)
})

// ------------------------------------------------------------------ consent
test("consent: accept needs the CURRENT notice version, withdraw takes effect immediately and deletes nothing", async () => {
  await rejects(H.aiSetLunaConsent(req("u1", { action: "accept", noticeVersion: 0 })), "invalid-argument", "notice-version-mismatch")
  await rejects(H.aiSetLunaConsent(req("u1", { action: "accept" })), "invalid-argument", "notice-version-mismatch")
  await rejects(H.aiSetLunaConsent(req("u1", { action: "maybe", noticeVersion: 1 })), "invalid-argument", "invalid-action")
  await rejects(H.aiSetLunaConsent(req("u1", { action: "accept", noticeVersion: 1, extra: 1 })), "invalid-argument")
  await rejects(H.aiSetLunaConsent(req("u1", { action: "accept", noticeVersion: 1 }, { verified: false })), "failed-precondition")
  await rejects(H.aiSetLunaConsent({ auth: undefined, data: { action: "accept", noticeVersion: 1 } }), "unauthenticated")
  assert.equal((await accept()).consent.active, true); const first = await chat("u1", "thanks"); assert.equal(textOf(first), REWRITE)
  const w = await H.aiSetLunaConsent(req("u1", { action: "withdraw" })); assert.equal(w.consent.active, false)
  assert.equal(textOf(await chat("u1", "thanks")), THANKS); assert.equal(calls.length, 1) // the very next message is already deterministic
  assert.equal((await H.aiListConversations(req("u1", {}))).conversations.length, 2) // history untouched
  const doc = env.get("ai-consent/u1"); assert.deepEqual(Object.keys(doc).sort(), ["acceptedAt", "active", "noticeVersion", "uid", "updatedAt", "withdrawnAt"]); assert.equal(doc.active, false)
  await accept(); assert.equal(env.get("ai-consent/u1").active, true); env.time.now += 13000; assert.equal(textOf(await chat("u1", "thanks")), REWRITE) // can opt back in
})
test("consent is per user, and deleting conversations never deletes or changes it", async () => {
  await accept("a"); assert.equal(textOf(await chat("b", "thanks")), THANKS) // b never consented
  const r = await chat("a", "thanks"); await H.aiDeleteConversation(req("a", { conversationId: r.conversationId })); assert.equal(env.get("ai-consent/a").active, true)
  await H.aiDeleteAllMyAiData(req("a", {})); assert.equal(env.get("ai-consent/a").active, true); assert.ok(lunaUser("a")) // usage counters are kept too
  assert.equal(env.list("ai-conversations").filter((c) => c.ownerUid === "a").length, 0)
})
test("aiGetUsage tells the app what it needs for the notice, and never fails because of Luna", async () => {
  env.seed("ai-config/default", { luna: { enabled: false } }); assert.deepEqual((await H.aiGetUsage(req("u1", {}))).luna, { available: false, noticeVersion: 1, consent: { active: false } })
  enable(); let u = (await H.aiGetUsage(req("u1", {}))).luna; assert.deepEqual([u.available, u.noticeVersion, u.consent.active, u.remainingToday, u.dailySuccessLimit], [true, 1, false, 10, 10])
  await accept(); await chat("u1", "thanks"); u = (await H.aiGetUsage(req("u1", {}))).luna; assert.deepEqual([u.consent.active, u.remainingToday], [true, 9])
})

// ------------------------------------------------------------------ configuration, kill switch and Super Admin
test("config: Luna is OFF by default; stored values can never exceed the hard ceilings; unknown settings (model, provider, key, price) are refused", async () => {
  assert.equal(cfgMod.DEFAULTS.luna.enabled, false)
  const sa = makeSuperAdmin(env, "root")
  const bad = [{ limits: { dailySuccessPerUser: 11 } }, { limits: { dailyAttemptsPerUser: 26 } }, { limits: { maxOutputTokens: 501 } }, { limits: { maxInputTokens: 3001 } }, { limits: { dailyGlobalTokens: 1500001 } }, { limits: { dailySuccessPerUser: 10, dailyAttemptsPerUser: 5 } },
    { limits: { maxConcurrentPerInstance: 3 } }, { limits: { recoveryConcurrent: 3 } }, { limits: { timeoutMs: 8001 } }, { breaker: { leaseSeconds: 9 } }, { model: "gpt-x" }, { limits: { model: "x" } }, { provider: "x" }, { apiKey: "x" }, { breaker: { failureThreshold: 0 } }, { enabled: "yes" }]
  for (const luna of bad) await rejects(H.aiAdminUpdateConfig(sa({ patch: { luna } })), "invalid-argument", "invalid-config")
  assert.deepEqual((await H.aiAdminUpdateConfig(sa({ patch: { luna: { enabled: true, limits: { dailySuccessPerUser: 5 } } } }))).updated, ["luna"])
  assert.equal((await cfgMod.getAiConfig()).luna.limits.dailySuccessPerUser, 5)
  env.seed("ai-config/default", { luna: { limits: { dailySuccessPerUser: 9999 } } }); const c = await cfgMod.getAiConfig(); assert.equal(c.luna.limits.dailySuccessPerUser, 10); assert.equal(c.luna.enabled, false) // an invalid stored document is ignored: defaults (OFF) apply
})
test("Super Admin sees settings, breaker state and today's global numbers: numbers and states only, no text or user data", async () => {
  await accept(); await chat("u1", "thanks"); const sa = makeSuperAdmin(env, "root"); const g = (await H.aiAdminGetUsage(sa({}))).config.luna
  assert.equal(g.enabled, true); assert.equal(g.breaker.state, "closed"); assert.deepEqual([g.today.tokens, g.today.calls], [430, 1])
  assert.doesNotMatch(JSON.stringify(g), /u1|thanks|Soweto|@/); await rejects(H.aiAdminGetUsage(req("u1", {})), "permission-denied")
})
test("logs never carry message text, the key, wording, or user ids", async () => {
  const prev = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key-not-real"
  try { await accept("uid-xyz"); install(async () => ({ ok: false, kind: "server", ms: 2 })); await chat("uid-xyz", "thanks, jane@example.com"); install(async () => goodOut("Visit Maponya Mall")); await chat("uid-xyz", "thanks") } finally { if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev }
  const logs = JSON.stringify(env.logs); assert.ok(env.logs.some((l) => /ai\.luna/.test(l.event))); for (const leak of ["jane", "uid-xyz", "test-key-not-real", "Maponya", "Anytime", "welcome"]) assert.ok(!logs.includes(leak), leak)
})

// ================================================================== ROUND 2
const settle = () => new Promise((r) => setImmediate(r))
const until = async (fn) => { for (let i = 0; i < 2000 && !fn(); i++) await settle(); assert.ok(fn(), "condition never became true") }
const gate = () => { let release; const p = new Promise((r) => { release = r }); return { p, release } }
const requestRecords = () => env.list("ai-usage").filter((d) => d.id.startsWith("luna_r_"))
const storedText = async (uid, r) => JSON.stringify((await conv.getConversation(uid, r.conversationId)).messages)

test("CONSENT RACE: withdrawn while the provider call is waiting -> Malloya's own wording is saved, no success counted, the paid tokens are still accounted", async () => {
  await accept(); const g = gate(); install(async () => { await g.p; return goodOut() })
  const pending = chat("u1", "thanks"); await until(() => calls.length === 1) // the provider request is now "in flight"
  await H.aiSetLunaConsent(req("u1", { action: "withdraw" })); assert.equal((await H.aiGetUsage(req("u1", {}))).luna.consent.active, false)
  g.release(); const r = await pending
  assert.equal(textOf(r), THANKS); const stored = await storedText("u1", r); assert.ok(stored.includes(THANKS) && !stored.includes("Anytime!"), "the Luna wording must not be stored")
  const u = lunaUser(); assert.deepEqual([u.attempts, u.successes, u.inputTokens, u.outputTokens], [1, 0, 400, 30]) // it was paid for, so the real usage is recorded; it is not a success
  assert.equal(shardTotal(), 430); const rec = requestRecords()[0]; assert.deepEqual([rec.state, rec.outcome, rec.actual], ["settled", "consent-withdrawn", 430])
  assert.equal((await H.aiGetUsage(req("u1", {}))).luna.remainingToday, 10) // the user's allowance was not consumed
  const again = await chat("u1", "thanks"); assert.equal(textOf(again), THANKS); assert.equal(calls.length, 1) // withdrawn: Luna is not used again
})
test("CONSENT RACE: consent still active at the end -> the Luna wording is stored (control for the test above)", async () => {
  await accept(); const g = gate(); install(async () => { await g.p; return goodOut() })
  const pending = chat("u1", "thanks"); await until(() => calls.length === 1); g.release(); const r = await pending
  assert.equal(textOf(r), REWRITE); assert.ok((await storedText("u1", r)).includes("Anytime!")); assert.equal(lunaUser().successes, 1)
})
test("CONSENT RACE: withdrawn and re-accepted during the call is fine; a withdraw that lands before the commit but after the provider answers is also honoured", async () => {
  await accept(); const g = gate(); install(async () => { await g.p; return goodOut() })
  const pending = chat("u1", "thanks"); await until(() => calls.length === 1)
  await H.aiSetLunaConsent(req("u1", { action: "withdraw" })); await H.aiSetLunaConsent(req("u1", { action: "accept", noticeVersion: 1 }))
  g.release(); assert.equal(textOf(await pending), REWRITE) // the CURRENT state at commit time decides
  await accept("u2"); const g2 = gate(); install(async () => { await g2.p; return goodOut() })
  const p2 = chat("u2", "thanks"); await until(() => calls.length === 2); g2.release()
  await H.aiSetLunaConsent(req("u2", { action: "withdraw" })); const r2 = await p2 // may land before or after the commit; both orders are valid, never a stored rewrite after withdrawal
  const stored = await storedText("u2", r2); const committedBefore = lunaUser("u2").successes === 1
  assert.equal(stored.includes("Anytime!"), committedBefore); assert.equal(textOf(r2) === REWRITE, committedBefore)
})
test("CONSENT RACE: a consent record for an older notice version is also treated as withdrawn at commit time", async () => {
  await accept(); const g = gate(); install(async () => { await g.p; return goodOut() })
  const pending = chat("u1", "thanks"); await until(() => calls.length === 1)
  env.seed("ai-consent/u1", { uid: "u1", noticeVersion: 0, active: true }); g.release(); assert.equal(textOf(await pending), THANKS); assert.equal(lunaUser().successes, 0)
})

test("OWNER KEY: two users with the SAME requestId cannot bypass the global recovery cap of 2", async () => {
  const cfg = cfgMod.merge(cfgMod.DEFAULTS, { luna: { enabled: true } }), breaker = require("../src/ai/luna/breaker")
  env.seed("ai-usage/luna-breaker", { state: "recovery", failures: [], invalid: [], overruns: 0, inflight: {}, recoveryUntil: env.time.now + 60000, cooldownSeconds: 60, cooldownUntil: 0, lease: null, blockedKind: null, resetEpoch: 0 })
  const users = ["a1", "a2", "a3", "a4"]; for (const u of users) await accept(u)
  const id = "req-shared-0001", gates = users.map(() => gate()); let k = 0
  install(async () => { const mine = gates[k++]; await mine.p; return goodOut() })
  const pend = users.map((u) => chat(u, "thanks", { requestId: id })); await until(() => calls.length >= 2); await settle(); await settle()
  assert.equal(calls.length, 2, "only two provider calls may be in flight during recovery, even though all four share one requestId")
  assert.equal(Object.keys(env.get("ai-usage/luna-breaker").inflight).length, 2)
  gates.forEach((x) => x.release()); const out = await Promise.all(pend); assert.equal(out.filter((r) => textOf(r) === REWRITE).length, 2); assert.equal(out.filter((r) => textOf(r) === THANKS).length, 2)
  assert.equal(calls.length, 2)
})

test("BREAKER e2e: HTTP 400/404 style failures block Luna, the user still gets Malloya's answer, and no later request calls the provider", async () => {
  await accept(); install(async () => ({ ok: false, kind: "bad_request", ms: 2 })); assert.equal(textOf(await chatT("u1", "thanks")), THANKS)
  assert.deepEqual([env.get("ai-usage/luna-breaker").state, env.get("ai-usage/luna-breaker").blockedKind], ["blocked", "bad_request"])
  install(async () => goodOut()); for (let i = 0; i < 3; i++) assert.equal(textOf(await chatT("u1", "thanks")), THANKS); assert.equal(calls.length, 1)
  env.time.now += 30 * 86400000; assert.equal(textOf(await chatT("u1", "thanks")), THANKS); assert.equal(calls.length, 1) // no automatic recovery, ever
  enable({ resetEpoch: 1 }); cfgMod.invalidateConfigCache(); assert.equal(textOf(await chatT("u1", "thanks")), REWRITE) // an operator reset works
})
test("BREAKER e2e: 8 rejected outputs among the last 10 open the breaker for 15 minutes; a probe then recovers", async () => {
  await accept(); install(async () => goodOut("x"))
  for (let i = 0; i < 7; i++) { assert.equal(textOf(await chatT("u1", "thanks")), THANKS); assert.equal(env.get("ai-usage/luna-breaker").state, "closed") }
  await chatT("u1", "thanks"); const b = env.get("ai-usage/luna-breaker"); assert.deepEqual([b.state, b.cooldownSeconds], ["open", 900]); assert.ok(b.cooldownUntil - env.time.now > 800000)
  const n = calls.length; install(async () => goodOut()); await chatT("u1", "thanks"); assert.equal(calls.length, n) // open: provider not called
  env.time.now += 901000; assert.equal(textOf(await chat("u1", "thanks")), REWRITE) // half-open probe succeeds
  assert.equal(env.get("ai-usage/luna-breaker").state, "recovery")
})
test("BREAKER e2e: 3 actual input-token reports above the limit hard-block Luna until an operator acts", async () => {
  await accept(); const over = () => ({ ok: true, text: JSON.stringify({ segments: { all: REWRITE } }), usage: { input: 3001, output: 20, cached: 0, reasoning: 0 }, ms: 3 })
  install(async () => over()); for (let i = 0; i < 2; i++) { await chatT("u1", "thanks"); assert.equal(env.get("ai-usage/luna-breaker").state, "closed") }
  assert.equal(textOf(await chatT("u1", "thanks")), REWRITE) // the third answer itself is valid and delivered...
  const b = env.get("ai-usage/luna-breaker"); assert.deepEqual([b.state, b.blockedKind], ["blocked", "input_overrun"]) // ...but Luna is now hard-blocked
  const n = calls.length; install(async () => goodOut()); assert.equal(textOf(await chatT("u1", "thanks")), THANKS); assert.equal(calls.length, n)
  assert.ok(env.logs.some((l) => /calibration_drift/.test(JSON.stringify(l))))
  enable({ resetEpoch: 1 }); cfgMod.invalidateConfigCache(); assert.equal(textOf(await chatT("u1", "thanks")), REWRITE)
})
test("CEILINGS e2e: a crafted over-ceiling config reaching tryRewrite is clamped (concurrency 2, outputs 500, timeout 8 s, daily 10/25)", async () => {
  const crafted = cfgMod.merge(cfgMod.DEFAULTS, { luna: { enabled: true, limits: { dailySuccessPerUser: 999, dailyAttemptsPerUser: 999, maxOutputTokens: 99999, maxConcurrentPerInstance: 50, timeoutMs: 600000, recoveryConcurrent: 50, dailyGlobalTokens: 99999999, maxInputTokens: 99999 } } })
  const users = ["c1", "c2", "c3", "c4"]; for (const u of users) await accept(u)
  const gates = users.map(() => gate()); let k = 0; install(async () => { await gates[k++].p; return goodOut() })
  const blocks = [{ type: "verified", text: THANKS }]
  const runs = users.map((u, i) => luna.tryRewrite({ uid: u, requestId: `req-clamp-000${i}`, cfg: crafted, intent: "thanks", blocks, language: "en", noticeVersion: 1 }))
  await until(() => calls.length >= 2); await settle(); await settle()
  assert.equal(calls.length, 2); assert.equal(luna.inflightNow(), 2) // 50 was clamped to 2
  assert.deepEqual([calls[0].maxOutputTokens, calls[0].timeoutMs], [500, 8000])
  gates.forEach((x) => x.release()); const res = await Promise.all(runs); assert.equal(res.filter((x) => x.applied).length, 2)
  assert.deepEqual(res.filter((x) => !x.applied).map((x) => x.skipped), ["busy", "busy"])
  // daily caps stay 10 successes / 25 attempts even though the crafted config says 999
  install(async () => goodOut()); const day = require("../src/lib/clock").todaySAST(), n0 = calls.length
  const seedUser = (uid, successes, attempts) => env.seed(`ai-usage/luna_u_${uid}_${day}`, { uid, day, attempts, successes, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 })
  const tryFor = (uid, i) => luna.tryRewrite({ uid, requestId: `req-cap-${uid}-${i}`, cfg: crafted, intent: "thanks", blocks, language: "en", noticeVersion: 1 })
  await accept("s10"); seedUser("s10", 10, 10); assert.equal((await tryFor("s10", 1)).skipped, "daily-allowance")
  await accept("s9"); seedUser("s9", 9, 9); assert.equal((await tryFor("s9", 1)).applied, true) // one below the ceiling still works
  await accept("a25"); seedUser("a25", 0, 25); assert.equal((await tryFor("a25", 1)).skipped, "usage:daily-attempts")
  await accept("a24"); seedUser("a24", 0, 24); assert.equal((await tryFor("a24", 1)).applied, true)
  assert.equal(calls.length - n0, 2) // only the two allowed requests reached the (mock) provider
})

// ================================================================== ROUND 3
const breakerMod = require("../src/ai/luna/breaker")
const txFailsForBreaker = (when) => {
  const real = env.db.runTransaction.bind(env.db)
  env.db.runTransaction = async (fn) => {
    if (!when()) return real(fn)
    let touches = false; const probe = { get: async () => ({ exists: false, data: () => ({}) }), set(r) { if (r.path === "ai-usage/luna-breaker") touches = true }, delete() {} } // fails only transactions that WRITE the breaker (begin() merely reads it)
    try { await fn(probe) } catch (e) { /* only inspecting which documents the callback reads */ }
    if (touches) throw Object.assign(new Error("UNAVAILABLE: simulated"), { code: 14 })
    return real(fn)
  }
  return () => { env.db.runTransaction = real }
}
const recsF = () => env.list("ai-usage").filter((d) => d.id.startsWith("luna_r_"))
const unresolvedF = () => recsF().filter((d) => d.unresolved === true)
const mkCfg = (o = {}) => cfgMod.merge(cfgMod.DEFAULTS, { luna: { enabled: true, ...o } })
const blocksT = () => [{ type: "verified", text: THANKS }]
const rewrite = (uid, requestId, cfg = mkCfg()) => luna.tryRewrite({ uid, requestId, cfg, intent: "thanks", blocks: blocksT(), language: "en", noticeVersion: 1 })
// "Instances" share ONE store (env). An instance is an in-memory flag set (local hold) + a write-access switch; the one that is "current" while a call runs is the one whose writes may fail.
let currentInstance = "A"; const writesLost = new Set()
const installInstanceFaults = () => {
  const real = env.db.runTransaction.bind(env.db)
  env.db.runTransaction = async (fn) => { if (writesLost.has(currentInstance)) throw Object.assign(new Error("UNAVAILABLE: this instance lost write access"), { code: 14 }); return real(fn) }
  return () => { env.db.runTransaction = real; writesLost.clear(); currentInstance = "A" }
}
const asInstance = async (name, fn) => { currentInstance = name; breakerMod.resetLocalForTests(); return fn() }

test("TWO INSTANCES: A commits `called`, then loses write access; B stays healthy. A makes no new paid call; B's exposure is bounded by the grace period; afterwards B is held off and the lost outcome is recovered", async () => {
  await accept("ua"); await accept("ub"); const restore = installInstanceFaults()
  try {
    install(async () => { writesLost.add("A"); return { ok: false, kind: "auth", ms: 3 } }) // the outage hits A right after its durable `called` commit
    const a1 = await asInstance("A", () => rewrite("ua", "req-two-a-0001")); assert.equal(a1.applied, false); assert.equal(calls.length, 1)
    const rec = recsF().find((r) => r.uid === "ua"); assert.deepEqual([rec.state, rec.unresolved], ["called", true]) // A could not record anything: the obligation is still on the record
    assert.equal(env.get("ai-usage/luna-breaker"), undefined)
    // A: its begin() cannot commit, so it makes no further paid call at all
    install(async () => goodOut()); const a2 = await asInstance("A", () => rewrite("ua", "req-two-a-0002")); assert.equal(a2.applied, false); assert.equal(calls.length, 1)
    // B (healthy, shared storage) inside the grace period: the record is genuinely "in flight" as far as B can tell. DOCUMENTED EXPOSURE.
    env.time.now += 80000; const b1 = await asInstance("B", () => rewrite("ub", "req-two-b-0001")); assert.equal(b1.applied, true); assert.equal(calls.length, 2)
    // B after the grace period: the record is stale, gets replayed conservatively, the breaker opens, B is held off
    env.time.now += 20000; const n = calls.length; const b2 = await asInstance("B", () => rewrite("ub", "req-two-b-0002")); assert.equal(b2.applied, false); assert.match(b2.skipped, /^breaker:open$/); assert.equal(calls.length, n)
    assert.equal(env.get("ai-usage/luna-breaker").state, "open"); assert.equal(recsF().find((r) => r.uid === "ua").state, "unreported"); assert.equal(unresolvedF().length, 0 + recsF().filter((r) => r.uid === "ub" && r.state === "called").length)
    // the probe after the cooldown finds the real problem (auth) and hard-blocks it
    env.time.now += 61000; install(async () => ({ ok: false, kind: "auth", ms: 3 })); await asInstance("B", () => rewrite("ub", "req-two-b-0003")); assert.equal(env.get("ai-usage/luna-breaker").state, "blocked")
    // permanent record: A can never cause a second paid call for the same uid+requestId, even after recovery
    writesLost.clear(); const before = calls.length; install(async () => goodOut()); await asInstance("A", () => rewrite("ua", "req-two-a-0001")); assert.equal(calls.length, before)
  } finally { restore() }
})
test("TWO INSTANCES: the lost outcome of a SUCCESSFUL-looking call is not forgotten either (record stays called -> conservative open), and reserved tokens stay charged", async () => {
  await accept("ua"); const restore = installInstanceFaults()
  try {
    install(async () => { writesLost.add("A"); return goodOut() }); await asInstance("A", () => rewrite("ua", "req-two-a-0101")) // call returned fine, but nothing can be committed afterwards
    const used = env.list("ai-usage").filter((d) => d.id.startsWith("luna_g_")).reduce((x, d) => x + d.tokens, 0); assert.ok(used > 0)
    env.time.now += 91000; writesLost.clear(); await accept("ub"); const r = await asInstance("B", () => rewrite("ub", "req-two-b-0101")); assert.equal(r.applied, false)
    assert.equal(env.list("ai-usage").filter((d) => d.id.startsWith("luna_g_")).reduce((x, d) => x + d.tokens, 0), used) // nothing released by the reconcile
  } finally { restore() }
})
test("TWO INSTANCES: concurrent reconcilers on different instances replay one lost outcome once", async () => {
  await accept("ua"); const restore = installInstanceFaults()
  try {
    install(async () => { writesLost.add("A"); return { ok: false, kind: "timeout", ms: 3 } }); await asInstance("A", () => rewrite("ua", "req-two-a-0201")); writesLost.clear()
    env.time.now += 91000; for (const u of ["b1", "b2", "b3", "b4"]) await accept(u); install(async () => goodOut())
    const out = await Promise.all(["b1", "b2", "b3", "b4"].map((u) => asInstance("B", () => rewrite(u, `req-two-${u}-0001`))))
    assert.equal(recsF().filter((r) => r.resolvedBy === "reconcile").length, 1); assert.equal(env.get("ai-usage/luna-breaker").state, "open"); assert.ok(out.every((x) => x.applied === false)); assert.equal(calls.length, 1) // only A's original call ever reached the provider
  } finally { restore() }
})
test("PENDING EVENT e2e: a lost AUTH update rides on the request record; no instance keeps spending; repair replays it into a real block", async () => {
  await accept("u1"); await accept("u2"); await accept("u3"); let broken = true; const restore = txFailsForBreaker(() => broken)
  install(async () => ({ ok: false, kind: "auth", ms: 2 })); assert.equal(textOf(await chatT("u1", "thanks")), THANKS)
  assert.equal(calls.length, 1); const rec = unresolvedF()[0]; assert.equal(rec.state, "settled"); assert.equal(rec.pendingEvent.kind, "auth"); assert.equal(env.get("ai-usage/luna-breaker"), undefined)
  install(async () => goodOut()); for (const u of ["u2", "u3", "u2"]) { breakerMod.resetLocalForTests(); assert.equal(textOf(await chatT(u, "thanks")), THANKS) } // deterministic fallback; reconcile keeps failing -> keeps denying
  assert.equal(calls.length, 1)
  broken = false; breakerMod.resetLocalForTests(); assert.equal(textOf(await chatT("u2", "thanks")), THANKS); assert.equal(calls.length, 1)
  assert.deepEqual([env.get("ai-usage/luna-breaker").state, env.get("ai-usage/luna-breaker").blockedKind], ["blocked", "auth"]); assert.equal(unresolvedF().length, 0); assert.equal(recsF()[0].outcome, "auth"); restore()
})
test("PENDING EVENT e2e: a Luna answer is still delivered and counted when only the breaker update is lost; the lost 8th rejection is replayed into a 900 s open", async () => {
  await accept("u1"); let broken = true; const restore = txFailsForBreaker(() => broken)
  env.seed("ai-usage/luna-breaker", { ...breakerMod.closed(0), invalid: [1, 1, 1, 1, 1, 1, 1] })
  install(async () => goodOut("bad words 123")); assert.equal(textOf(await chatT("u1", "thanks")), THANKS); assert.equal(calls.length, 1); assert.equal(unresolvedF().length, 1)
  install(async () => goodOut()); assert.equal(textOf(await chatT("u1", "thanks")), THANKS); assert.equal(calls.length, 1) // held: no new call
  broken = false; breakerMod.resetLocalForTests(); await chatT("u1", "thanks"); assert.equal(env.get("ai-usage/luna-breaker").state, "open"); assert.equal(env.get("ai-usage/luna-breaker").cooldownSeconds, 900); assert.equal(calls.length, 1); restore()
})
test("PENDING EVENT e2e: many instances while the breaker keeps failing: no paid call after the first lost update", async () => {
  const users = ["m1", "m2", "m3", "m4", "m5", "m6"]; for (const u of users) await accept(u); const restore = txFailsForBreaker(() => true)
  install(async () => ({ ok: false, kind: "bad_request", ms: 2 })); await chatT("m1", "thanks"); assert.equal(calls.length, 1)
  install(async () => goodOut()); const out = []; for (const u of users.slice(1)) { breakerMod.resetLocalForTests(); out.push(textOf(await chatT(u, "thanks"))) }
  assert.ok(out.every((t) => t === THANKS)); assert.equal(calls.length, 1); restore()
})
test("UNRESOLVED e2e: a normal Luna call leaves NO unresolved record (cleared in the same settlement) and the query stays empty", async () => {
  await accept("u1"); assert.equal(textOf(await chat("u1", "thanks")), REWRITE); const r = recsF()[0]; assert.equal("unresolved" in r, false); assert.equal(r.state, "settled"); assert.equal(unresolvedF().length, 0)
  install(async () => ({ ok: false, kind: "timeout", ms: 2 })); env.time.now += 13000; await chatT("u1", "thanks"); assert.equal(unresolvedF().length, 0)
})
test("RECORDS: luna_r_* has no expireAt in any state, and the same uid+requestId never reaches the provider again, even years later", async () => {
  await accept("u1"); install(async () => goodOut()); const idOk = "req-keep-ok-0001", idFail = "req-keep-fail-0002"
  assert.equal(textOf(await chat("u1", "thanks", { requestId: idOk })), REWRITE)
  install(async () => ({ ok: false, kind: "timeout", ms: 5 })); env.time.now += 13000; await chatT("u1", "thanks", { requestId: idFail }) // a second call that failed
  const recs = env.list("ai-usage").filter((d) => d.id.startsWith("luna_r_")); assert.equal(recs.length, 2)
  for (const x of recs) { assert.equal("expireAt" in x, false, x.state); assert.equal(x.state, "settled") }
  assert.ok(env.list("ai-usage").filter((d) => d.id.startsWith("luna_u_") || d.id.startsWith("luna_g_")).every((d) => d.expireAt)) // the daily counters still expire
  const before = calls.length, blocks = [{ type: "verified", text: THANKS }], cfg = cfgMod.merge(cfgMod.DEFAULTS, { luna: { enabled: true } })
  for (const years of [1, 5]) {
    env.time.now += years * 365 * 86400000; install(async () => goodOut()); breakerMod.resetLocalForTests()
    for (const id of [idOk, idFail]) { const again = await luna.tryRewrite({ uid: "u1", requestId: id, cfg, intent: "thanks", blocks, language: "en", noticeVersion: 1 }); assert.equal(again.applied, false, id) }
  }
  assert.equal(calls.length, before) // never a second paid call for either requestId
  assert.equal(env.list("ai-usage").filter((d) => d.id.startsWith("luna_r_")).length, 2) // and nothing deleted them
})

// ================================================================== ROUND 5: stale admission is closed at the commit point; late outcomes end to end
const openBreaker = async () => { for (let i = 0; i < 3; i++) await breakerMod.report({ owner: `f${i}`, mode: "normal", ok: false, kind: "timeout", cfg: mkCfg() }) }
const interleave = (after) => { // runs `after` once, right after the NEXT admit() decided, i.e. between admission and begin()
  const real = breakerMod.admit; let done = false
  breakerMod.admit = async (a) => { const g = await real(a); if (!done) { done = true; await after(g) } return g }
  return () => { breakerMod.admit = real }
}
test("STALE ADMISSION e2e: the breaker is BLOCKED by another instance between admit() and begin(): no `called` record, no budget, no provider call", async () => {
  await accept("u1"); const restore = interleave(async () => { await breakerMod.report({ owner: "other", mode: "normal", ok: false, kind: "billing", cfg: mkCfg() }) })
  try {
    const r = await rewrite("u1", "req-s1-0001"); assert.equal(r.applied, false); assert.equal(r.skipped, "usage:breaker-blocked")
    assert.equal(calls.length, 0); assert.equal(recsF().length, 0); assert.equal(env.list("ai-usage").filter((d) => d.id.startsWith("luna_u_") || d.id.startsWith("luna_g_")).length, 0)
    install(async () => goodOut()); breakerMod.resetLocalForTests(); assert.equal((await rewrite("u1", "req-s1-0001")).applied, false); assert.equal(calls.length, 0) // blocked stays blocked; and the requestId was not burnt
  } finally { restore() }
})
test("STALE ADMISSION e2e: the breaker OPENED between admit() and begin(): no provider call", async () => {
  await accept("u1"); const restore = interleave(async () => { await openBreaker() })
  try { const r = await rewrite("u1", "req-s2-0001"); assert.equal(r.skipped, "usage:breaker-changed"); assert.equal(calls.length, 0); assert.equal(recsF().length, 0) } finally { restore() }
})
test("STALE ADMISSION e2e: a PROBE whose lease was replaced between admit() and begin() makes no call; the replacement probe does", async () => {
  await accept("pa"); await accept("pb"); await openBreaker(); env.time.now += 61000
  const restore = interleave(async () => { env.time.now += 31000; assert.equal((await breakerMod.admit({ owner: breakerMod.ownerKey("pb", "req-s3-0002"), cfg: mkCfg() })).mode, "probe") }) // B takes the replacement lease
  try {
    const a = await rewrite("pa", "req-s3-0001"); assert.equal(a.applied, false); assert.equal(a.skipped, "usage:breaker-changed"); assert.equal(calls.length, 0)
  } finally { restore() }
  assert.equal(env.get("ai-usage/luna-breaker").lease.owner, breakerMod.ownerKey("pb", "req-s3-0002")); assert.equal(recsF().length, 0) // B's lease is intact; A left nothing behind
})
test("STALE ADMISSION e2e: a RECOVERY slot that expired between admit() and begin() makes no call", async () => {
  await accept("ra"); env.seed("ai-usage/luna-breaker", { ...breakerMod.closed(0), state: "recovery", recoveryUntil: env.time.now + 600000, inflight: {} })
  const restore = interleave(async () => { env.time.now += 31000 })
  try { const r = await rewrite("ra", "req-s4-0001"); assert.equal(r.applied, false); assert.equal(r.skipped, "usage:breaker-changed"); assert.equal(calls.length, 0); assert.equal(recsF().length, 0) } finally { restore() }
})
test("LATE OUTCOMES e2e: a probe whose lease was replaced finishes late: its answer is delivered, the breaker is untouched, and B's probe still decides", async () => {
  await accept("pa"); await accept("pb"); await openBreaker(); env.time.now += 61000
  const gA = gate(), gB = gate(); let n = 0; install(async () => { const mine = n++ === 0 ? gA : gB; await mine.p; return goodOut() })
  const pa = rewrite("pa", "req-l1-0001"); await until(() => calls.length === 1) // A: probe in flight
  env.time.now += 31000; const pb = rewrite("pb", "req-l1-0002"); await until(() => calls.length === 2) // A's lease expired; B took over
  const lease = JSON.stringify(env.get("ai-usage/luna-breaker").lease); assert.equal(env.get("ai-usage/luna-breaker").state, "half_open")
  gA.release(); const ra = await pa; assert.equal(ra.applied, true) // A's valid answer is still used
  assert.equal(env.get("ai-usage/luna-breaker").state, "half_open"); assert.equal(JSON.stringify(env.get("ai-usage/luna-breaker").lease), lease) // ...but it did not touch B's probe
  assert.equal((await breakerMod.admit({ owner: "x", cfg: mkCfg() })).reason, "probe-in-progress")
  gB.release(); await pb; assert.equal(env.get("ai-usage/luna-breaker").state, "recovery")
})
test("LATE OUTCOMES e2e: a delayed recovery failure whose slot expired does not re-open the breaker; the expired slot is purged and live slots stay <= 2", async () => {
  await accept("r1"); await accept("r2"); env.seed("ai-usage/luna-breaker", { ...breakerMod.closed(0), state: "recovery", recoveryUntil: env.time.now + 600000, inflight: {} })
  const gs = [gate(), gate()]; let k = 0; install(async () => { const i = k++; await gs[i].p; return i === 0 ? { ok: false, kind: "timeout", ms: 1 } : goodOut() })
  const p1 = rewrite("r1", "req-l2-0001"); await until(() => calls.length === 1); assert.equal(Object.keys(env.get("ai-usage/luna-breaker").inflight).length, 1)
  env.time.now += 31000 // r1's slot expires while its call is still running
  const p2 = rewrite("r2", "req-l2-0002"); await until(() => calls.length === 2)
  const live = Object.keys(env.get("ai-usage/luna-breaker").inflight); assert.equal(live.length, 1); assert.equal(live[0], breakerMod.ownerKey("r2", "req-l2-0002")) // the expired slot was purged
  gs[0].release(); const a = await p1; assert.equal(a.applied, false); assert.equal(env.get("ai-usage/luna-breaker").state, "recovery"); assert.equal(Object.keys(env.get("ai-usage/luna-breaker").inflight).length, 1) // r1's late failure is ignored
  gs[1].release(); assert.equal((await p2).applied, true); assert.equal(env.get("ai-usage/luna-breaker").state, "recovery"); assert.equal(Object.keys(env.get("ai-usage/luna-breaker").inflight).length, 0)
})
test("HARD BLOCK e2e: a provider answer arriving after the breaker was blocked cannot clear the block (and its text is still delivered)", async () => {
  await accept("u1"); const g = gate(); install(async () => { await g.p; return goodOut() })
  const p = rewrite("u1", "req-hb-0001"); await until(() => calls.length === 1)
  await breakerMod.report({ owner: "other", mode: "normal", ok: false, kind: "auth", cfg: mkCfg() }); assert.equal(env.get("ai-usage/luna-breaker").state, "blocked")
  g.release(); assert.equal((await p).applied, true); assert.equal(env.get("ai-usage/luna-breaker").state, "blocked"); assert.equal(env.get("ai-usage/luna-breaker").blockedKind, "auth")
  const cfg1 = mkCfg({ resetEpoch: 1 }); assert.equal((await breakerMod.admit({ owner: "op", cfg: cfg1 })).allowed, true) // only the operator reset clears it
})
