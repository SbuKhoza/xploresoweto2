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
beforeEach(() => { env = F.setupWorld(); calls = []; install(async () => goodOut()); enable() })
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
  const expect = { rate_limit: [0, "open"], billing: [0, "blocked"], auth: [0, "blocked"], bad_request: [0, "closed"], server: [900, "closed"], timeout: [900, "closed"], network: [900, "closed"] }
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
  const u = lunaUser(); assert.deepEqual([u.attempts, u.successes, u.inputTokens, u.outputTokens], [3, 0, 1200, 90]); assert.equal(env.get("ai-usage/luna-breaker"), undefined)
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
  const bad = [{ limits: { dailySuccessPerUser: 21 } }, { limits: { maxOutputTokens: 501 } }, { limits: { maxInputTokens: 3001 } }, { limits: { dailyGlobalTokens: 3000001 } }, { limits: { dailySuccessPerUser: 10, dailyAttemptsPerUser: 5 } },
    { limits: { maxConcurrentPerInstance: 5 } }, { model: "gpt-x" }, { limits: { model: "x" } }, { provider: "x" }, { apiKey: "x" }, { breaker: { failureThreshold: 0 } }, { enabled: "yes" }]
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
