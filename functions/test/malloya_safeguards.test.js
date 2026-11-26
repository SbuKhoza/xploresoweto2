"use strict"
// Learning safeguards: deletion vs erasure, duplicate/concurrent/midnight counting, screen hardening, opt-out and collection-disable races,
// expiry, knowledge validation, cache invalidation, audit consistency. In-memory Firebase only: no emulator, network or provider.
const test = require("node:test"), assert = require("node:assert/strict")
const { setup } = require("./helpers")
const cfgMod = require("../src/ai/config")
const knowledge = require("../src/ai/learning/knowledge")
const screen = require("../src/ai/learning/screen")
const store = require("../src/ai/learning/store")
const erasure = require("../src/ai/erasure")
const H = require("../src/handlers/learning")
const AI = require("../src/handlers/ai")
const { runChat } = require("../src/ai/chat")
const { AI_COL } = require("../src/ai/constants")

const ON = { learning: { collect: true, privacyAcknowledged: true } }
let env
function fresh(over = {}) {
  env = setup(); cfgMod.setConfigCacheTtlForTests(0); knowledge.setTtlForTests(0)
  env.seed("super-admin/root", { uid: "root", role: "super_admin", active: true })
  env.seed("ai-config/default", over)
}
const req = (uid, data, extra = {}) => ({ auth: { uid, token: { email_verified: true, email: `${uid}@example.org`, ...extra } }, data })
const admin = (data) => req("root", data, { superAdmin: true })
const user = (uid, data) => req(uid, data)
const col = (name) => [...env.db.store.keys()].filter((k) => k.startsWith(`${name}/`) && k.split("/").length === 2).map((k) => ({ id: k.split("/")[1], ...env.db.store.get(k) }))
async function say(uid, message, n, conversationId) { env.time.now += 61000; return runChat({ uid, cfg: await cfgMod.getAiConfig(), data: { message, requestId: `req_${uid}_${n}_xxxx`, ...(conversationId ? { conversationId } : {}) } }) }
const rec = (uid, sig, key, kind = "no_match") => store.recordSignal({ uid, kind, sig, dedupeKey: key })
const SIG = "do you have a <x> trip over soweto", MISS = "do you have a helicopter trip over soweto"

test("deleting one conversation or all history keeps the learning opt-out, the Luna notice choice, the throttle record and usage counters", async () => {
  fresh(ON)
  env.seed("ai-consent/u1", { uid: "u1", active: true, noticeVersion: 1 })
  await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  const r = await say("u1", "find a restaurant in soweto", 1)
  await AI.aiDeleteConversation(user("u1", { conversationId: r.conversationId }))
  const r2 = await say("u1", "find a restaurant in soweto", 2)
  assert.ok(r2.conversationId)
  const out = await AI.aiDeleteAllMyAiData(user("u1", {}))
  assert.equal(out.deleted, true)
  assert.ok(env.db.store.has("ai-learning-optout/u1"), "opt-out preserved")
  assert.equal(env.get("ai-consent/u1").active, true, "notice choice preserved")
  assert.ok(col("ai-usage").some((d) => d.id.includes("u1")), "usage counters preserved")
  assert.equal(col(AI_COL.conversations).length, 0)
  assert.equal((await AI.aiGetUsage(user("u1", {}))).learning.optedOut, true)
})

test("AI data erasure is a separate, confirmed operation: removes history, notice record, bookkeeping and registered memory; keeps opt-out and financial counters", async () => {
  fresh(ON)
  env.seed("ai-consent/u1", { uid: "u1", active: true, noticeVersion: 1 }); env.seed("ai-usage/luna_u_u1_2026-11-20", { n: 3 }); env.seed("ai-usage/luna_r_abc", { state: "settled" })
  await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  await say("u1", MISS, 1); await rec("u3", SIG, "chat:x")
  env.db.store.set("ai-learning-seen/u1_2026-11-20", { ownerUid: "u1", n: 1, keys: [] }); env.db.store.set("ai-learning-events/e9", { ownerUid: "u1" })
  let memoryErased = null; erasure.registerEraser("test-memory", async (uid) => { memoryErased = uid; return 2 })
  await assert.rejects(AI.aiEraseMyAiData(user("u1", {})), (e) => e.message === "confirmation-required")
  await assert.rejects(AI.aiEraseMyAiData(user("u1", { confirm: "yes" })), (e) => e.message === "confirmation-required")
  await assert.rejects(AI.aiEraseMyAiData({ data: { confirm: "ERASE-MY-AI-DATA" } }), (e) => e.code === "unauthenticated")
  const r = await AI.aiEraseMyAiData(user("u1", { confirm: "ERASE-MY-AI-DATA" }))
  assert.equal(r.erased, true); assert.equal(memoryErased, "u1")
  assert.ok(!env.db.store.has("ai-consent/u1")); assert.equal(col(AI_COL.conversations).length, 0)
  assert.ok(!col(AI_COL.seen).some((d) => d.ownerUid === "u1")); assert.ok(!col(AI_COL.events).some((d) => d.ownerUid === "u1"))
  assert.ok(env.db.store.has("ai-learning-optout/u1"), "erasing data never silently re-enrols someone")
  assert.ok(env.db.store.has("ai-usage/luna_u_u1_2026-11-20") && env.db.store.has("ai-usage/luna_r_abc"), "financial safeguards untouched")
  assert.equal(col(AI_COL.candidates).length, 1, "anonymous aggregates remain")
  await AI.aiEraseMyAiData(user("u1", { confirm: "ERASE-MY-AI-DATA", releaseOptOut: true }))
  assert.ok(!env.db.store.has("ai-learning-optout/u1"))
  await erasure.eraseAiAccountData("u2", { accountClosed: true }) // library entry point for a future account-closure hook
})

test("account closure removes the opt-out flag too", async () => {
  fresh(ON); await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  const r = await erasure.eraseAiAccountData("u1", { accountClosed: true })
  assert.equal(r.learning.optOut, true); assert.ok(!env.db.store.has("ai-learning-optout/u1"))
})

test("duplicates cannot inflate counts: concurrent identical events, retries, and retries after midnight", async () => {
  fresh(ON)
  const rs = await Promise.all(Array.from({ length: 6 }, () => rec("u1", SIG, "chat:req1")))
  assert.equal(rs.filter((r) => r.recorded).length, 1); assert.equal(col(AI_COL.candidates)[0].count, 1)
  env.time.now += 26 * 3600 * 1000 // the retry arrives after midnight
  assert.equal((await rec("u1", SIG, "chat:req1")).reason, "duplicate"); assert.equal(col(AI_COL.candidates)[0].count, 1)
  assert.equal((await rec("u1", SIG, "chat:req2")).recorded, true, "a genuinely new request the next day counts")
  assert.equal(col(AI_COL.candidates)[0].count, 2)
})

test("many users at once are all counted exactly once (no lost updates), and one user cannot exceed their daily cap concurrently", async () => {
  fresh({ learning: { collect: true, privacyAcknowledged: true, maxPerUserPerDay: 3, maxNewPerDay: 100 } })
  await Promise.all(Array.from({ length: 8 }, (_, i) => rec(`user${i}`, SIG, `chat:r${i}`)))
  assert.equal(col(AI_COL.candidates)[0].count, 8)
  const sigs = ["find a hotel near <place>", "find a cafe near <place>", "find a bar near <place>", "find a park near <place>", "find a mall near <place>"]
  const rs = await Promise.all(sigs.map((g, i) => rec("greedy", g, `chat:g${i}`)))
  assert.equal(rs.filter((r) => r.recorded).length, 3)
})

test("feedback can be submitted once per message: a resubmission the next day is a duplicate", async () => {
  fresh(ON)
  const r = await say("u1", "find a restaurant in soweto", 1)
  const msgId = [...env.db.store.keys()].find((k) => /_a$/.test(k)).split("/").pop()
  const fb = (extra = {}) => H.aiSubmitFeedback(user("u1", { conversationId: r.conversationId, messageId: msgId, rating: "unhelpful", ...extra }))
  assert.equal((await fb()).recorded, true)
  env.time.now += 30 * 3600 * 1000
  assert.deepEqual(await fb(), { recorded: false, reason: "duplicate" })
  assert.deepEqual(await fb({ correctionIntent: "find_accommodation" }), { recorded: true }, "a different kind (correction) is a different event")
  assert.equal(col(AI_COL.candidates).filter((c) => /^feedback/.test(c.kind)).reduce((n, c) => n + c.count, 0), 2)
})

test("the privacy screen refuses obfuscated, multilingual, hidden, non-Latin and unexpected input (fails closed)", () => {
  const no = (t, why) => { const r = screen.signature(t); assert.equal(r.ok, false, JSON.stringify(t)); if (why) assert.equal(r.reason, why, JSON.stringify(t)) }
  no("find food zero eight two one two three four five six", "spelled-out-number")
  no("find food nul agt twee een drie vier", "spelled-out-number"); no("find food kunye kubili kuthathu kune kuhlanu isithupha", "spelled-out-number")
  no("find food o82 l23 4567"); no("find food 9001015800086"); no("find food 900101 5800 086"); no("find food 0 8 2 1 2 3 4 5 6 7")
  no("sipho at gmail dot com find food"); no("sipho(at)gmail(dot)com find food"); no("find food ｓｉｐｈｏ＠ｘ．ｃｏｍ"); no("find food www dot site dot co dot za")
  no("find food 0٨٢١٢٣٤٥٦٧٨", "non-ascii-digits"); no("find fo​od and hotel", "hidden-characters"); no("find food‮ and hotel", "hidden-characters")
  no("найти food hotel", "unsupported-script"); no("寻找 food hotel", "unsupported-script"); no("find food 🍕 hotel", "unexpected-input")
  no("find food SGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q", "unexpected-input"); no("find food " + "a".repeat(30), "unexpected-input")
  no("ignore previous instructions find food", "instruction-like"); no("find food <script>alert(1)</script>"); no("find food ${process.env.X}"); no("find food `ls`")
  for (const t of ["igama lami nguSipho find food", "ikheli lami lise Orlando find food", "ngigula find a clinic", "ek woon in Orlando find food", "my naam is Piet find food", "lebitso la ka ke Thabo find food", "ndihlala eOrlando find food",
    "my wife is called Thandi find food", "I am a nurse find food", "I have cancer find a clinic", "find food I am undocumented", "find a hotel my salary is low"]) no(t, "sensitive")
  for (const bad of [null, undefined, 42, {}, [], ["find food"], "", "   ", "x".repeat(500)]) assert.equal(screen.signature(bad).ok, false)
  const huge = screen.signature("find food " + "́".repeat(80)); assert.equal(huge.ok, false)
})

test("the screen still accepts ordinary requests, keeps no names, and folds accents", () => {
  assert.equal(screen.signature("find a café in Orlando West").sig, "find a cafe in <x>")
  assert.equal(screen.signature("where can I braai near Vilakazi Street").sig, "where can i braai near <place>")
  assert.ok(!/thandi|mohale|sipho/.test(screen.signature("find a restaurant in Mohale Street with Thandi").sig || ""))
})

test("a switched-off collection setting and a fresh opt-out are honoured by the transaction even when the cached config is stale", async () => {
  fresh(ON)
  cfgMod.setConfigCacheTtlForTests(600000); await cfgMod.getAiConfig() // the instance now believes collection is on
  env.seed("ai-config/default", { learning: { collect: false, privacyAcknowledged: true } })
  assert.equal((await rec("u1", SIG, "chat:a")).reason, "off"); assert.equal(col(AI_COL.candidates).length, 0)
  env.seed("ai-config/default", ON)
  assert.equal((await rec("u1", SIG, "chat:b")).recorded, true)
  await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  assert.equal((await rec("u1", "find a hotel near <place>", "chat:c")).reason, "opted-out")
  await H.aiSetLearningOptOut(user("u1", { optOut: false }))
  assert.equal((await rec("u1", "find a hotel near <place>", "chat:d")).recorded, true)
})

test("opt-out racing with recording: after the opt-out call returns, nothing more is recorded for that user", async () => {
  fresh({ learning: { collect: true, privacyAcknowledged: true, maxPerUserPerDay: 50 } })
  const sigs = Array.from({ length: 8 }, (_, i) => `find a ${["hotel", "cafe", "bar", "park", "mall", "tour", "show", "event"][i]} near <place>`)
  const racing = Promise.all(sigs.map((g, i) => rec("u1", g, `chat:p${i}`)))
  await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  await racing
  const before = col(AI_COL.candidates).length
  for (let i = 0; i < 4; i++) assert.equal((await rec("u1", sigs[i], `chat:q${i}`)).reason, "opted-out")
  assert.equal(col(AI_COL.candidates).length, before)
})

test("expired candidates cannot be reviewed, approved or listed; a new occurrence restarts a fresh candidate", async () => {
  fresh({ learning: { collect: true, privacyAcknowledged: true, candidateRetentionDays: 5 } })
  await rec("u1", SIG, "chat:1")
  const id = col(AI_COL.candidates)[0].id
  env.time.now += 6 * 86400000
  assert.equal((await H.aiAdminListLearningCandidates(admin({}))).candidates.length, 0)
  await assert.rejects(H.aiAdminReviewCandidate(admin({ candidateId: id, decision: "approve", type: "answer", payload: { sigs: [SIG], text: "Ask a listed tour operator." } })), (e) => e.message === "candidate-expired")
  await assert.rejects(H.aiAdminReviewCandidate(admin({ candidateId: id, decision: "reject", reason: "other" })), (e) => e.message === "candidate-expired")
  assert.equal(col(AI_COL.knowledge).length, 0)
  assert.equal((await rec("u2", SIG, "chat:2")).recorded, true)
  const c = col(AI_COL.candidates)[0]; assert.equal(c.count, 1); assert.equal(c.status, "new")
  assert.equal((await H.aiAdminListLearningCandidates(admin({}))).candidates.length, 1)
})

test("knowledge validation: generic or built-in aliases, duplicates, empty edits, and signature collisions are refused", async () => {
  fresh(ON)
  const save = (type, payload) => H.aiAdminSaveKnowledge(admin({ type, payload }))
  const bad = (p, msg) => assert.rejects(p, (e) => e.message === msg, msg)
  await bad(save("place_alias", { alias: "mall", canonical: "Maponya Mall" }), "alias-too-generic")
  await bad(save("place_alias", { alias: "the park", canonical: "Maponya Mall" }), "alias-too-generic")
  await bad(save("place_alias", { alias: "maponya", canonical: "Maponya Mall" }), "alias-already-built-in")
  await bad(save("place_alias", { alias: "Kasi Mall", canonical: "Maponya Mall" }), "invalid-alias")
  await bad(save("place_alias", { alias: "my name", canonical: "Maponya Mall" }), "invalid-alias")
  await save("place_alias", { alias: "kasi mall", canonical: "Maponya Mall" })
  await bad(save("place_alias", { alias: "kasi mall", canonical: "FNB Stadium" }), "alias-in-use")
  const a = await save("answer", { sigs: [SIG], text: "Ask a listed tour operator about flights." })
  await bad(save("answer", { sigs: [SIG, "find a hotel near <place>"], text: "Another answer for the same thing." }), "signature-in-use")
  const b = await save("answer", { sigs: ["find a hotel near <place>"], text: "Hotels are listed under accommodation." })
  await bad(H.aiAdminUpdateKnowledge(admin({ knowledgeId: b.knowledgeId, action: "edit", payload: { sigs: [SIG] } })), "signature-in-use")
  await bad(H.aiAdminUpdateKnowledge(admin({ knowledgeId: b.knowledgeId, action: "edit", payload: {} })), "invalid-payload")
  await bad(H.aiAdminUpdateKnowledge(admin({ knowledgeId: b.knowledgeId, action: "edit", payload: { intent: "emergency" } })), "invalid-payload")
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: a.knowledgeId, action: "revoke", reason: "outdated" }))
  await save("answer", { sigs: [SIG], text: "A newer answer for the same question." }) // a revoked item frees its signature
})

test("cache invalidation: an in-flight load that started before a revocation cannot cache the stale result; ties resolve deterministically", async () => {
  fresh(ON)
  knowledge.setTtlForTests(600000)
  const cfg = await cfgMod.getAiConfig()
  const k = await H.aiAdminSaveKnowledge(admin({ type: "answer", payload: { sigs: [SIG], text: "Ask a listed tour operator about flights." } }))
  assert.equal((await knowledge.loadActive(cfg)).answers.size, 1)
  const inflight = knowledge.loadActive(cfg); knowledge.invalidate()
  await inflight
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k.knowledgeId, action: "revoke", reason: "incorrect" }))
  assert.equal((await knowledge.loadActive(cfg)).answers.size, 0, "revocation is visible at once on this instance")
  const slow = knowledge.loadActive(cfg)
  env.seed("ai-knowledge/aaaaaaaaaaaaaaaaaaaaaaaa", { type: "answer", status: "active", version: 1, sigs: ["find a hotel near <place>"], text: "First answer text here." })
  env.seed("ai-knowledge/bbbbbbbbbbbbbbbbbbbbbbbb", { type: "answer", status: "active", version: 1, sigs: ["find a hotel near <place>"], text: "Second answer text here." })
  knowledge.invalidate(); await slow
  assert.equal((await knowledge.loadActive(cfg)).answers.get("find a hotel near <place>").text, "First answer text here.")
})

test("audit consistency: every successful change writes exactly one entry; refused or failed changes write none; purge and its audit commit together", async () => {
  fresh(ON)
  const audits = () => col("audit-log").filter((a) => /^ai\./.test(a.action)).map((a) => a.action)
  await rec("u1", SIG, "chat:1"); const id = col(AI_COL.candidates)[0].id
  await assert.rejects(H.aiAdminReviewCandidate(admin({ candidateId: id, decision: "approve", type: "answer", payload: { sigs: [SIG], text: "see https://x.example/y" } })))
  await assert.rejects(H.aiAdminUpdateKnowledge(admin({ knowledgeId: "a".repeat(24), action: "revoke", reason: "other" })))
  assert.deepEqual(audits(), [])
  await H.aiAdminReviewCandidate(admin({ candidateId: id, decision: "approve", type: "answer", payload: { sigs: [SIG], text: "Ask a listed tour operator about flights." } }))
  const k = col(AI_COL.knowledge)[0].id
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k, action: "disable", reason: "not_useful" }))
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k, action: "disable", reason: "not_useful" })) // no-op: no entry
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k, action: "enable" }))
  await H.aiAdminPurgeLearning(admin({ scope: "rejected" }))
  await AI.aiAdminUpdateConfig(admin({ patch: { learning: { use: false, maxPerUserPerDay: 4 } } }))
  assert.deepEqual(audits().sort(), ["ai.config.update", "ai.knowledge.disable", "ai.knowledge.enable", "ai.learning.approve", "ai.learning.purge"])
  const cfgAudit = col("audit-log").find((a) => a.action === "ai.config.update"); assert.deepEqual(cfgAudit.details.learning, { use: false, maxPerUserPerDay: 4 })
  assert.equal((await H.aiAdminKnowledgeHistory(admin({ knowledgeId: k }))).versions.length, 3)
})

test("aiGetUsage tells the app what is really on: learning unavailable by default, available only with both switches, opt-out always reported", async () => {
  fresh()
  assert.deepEqual((await AI.aiGetUsage(user("u1", {}))).learning, { available: false, noticeVersion: 1, optedOut: false })
  await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  assert.equal((await AI.aiGetUsage(user("u1", {}))).learning.optedOut, true)
  fresh(ON)
  assert.equal((await AI.aiGetUsage(user("u1", {}))).learning.available, true)
})

test("Luna and the financial safeguards are untouched: Luna stays off, its config keys and ceilings are unchanged, and no learning code references a provider", async () => {
  fresh(ON)
  const cfg = await cfgMod.getAiConfig()
  assert.equal(cfg.luna.enabled, false)
  await assert.rejects(AI.aiAdminUpdateConfig(admin({ patch: { luna: { limits: { dailyGlobalTokens: 999999999 } } } })), (e) => e.code === "invalid-argument")
  assert.deepEqual(Object.keys(cfg.luna).sort(), ["breaker", "enabled", "limits", "resetEpoch"])
})
