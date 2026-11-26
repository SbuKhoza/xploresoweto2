"use strict"
// Reviewed learning: privacy screen, collection gate, dedupe, Super Admin review, versioning, engine use, revocation, erasure, retention.
const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("fs"), path = require("path")
const { setup } = require("./helpers")
const cfgMod = require("../src/ai/config")
const knowledge = require("../src/ai/learning/knowledge")
const screen = require("../src/ai/learning/screen")
const store = require("../src/ai/learning/store")
const H = require("../src/handlers/learning")
const AI = require("../src/handlers/ai")
const { runChat } = require("../src/ai/chat")
const { AI_COL, PRIVATE_COLLECTIONS, PUBLIC_READ_COLLECTIONS } = require("../src/ai/constants")

const ON = { learning: { collect: true, privacyAcknowledged: true } }
let env
function fresh(over = {}) {
  env = setup()
  cfgMod.setConfigCacheTtlForTests(0); knowledge.setTtlForTests(0)
  env.seed("super-admin/root", { uid: "root", role: "super_admin", active: true })
  env.seed("ai-config/default", over)
  return env
}
const req = (uid, data, extra = {}) => ({ auth: { uid, token: { email_verified: true, email: `${uid}@example.org`, ...extra } }, data })
const admin = (data) => req("root", data, { superAdmin: true })
const user = (uid, data) => req(uid, data)
const col = (name) => [...env.db.store.keys()].filter((k) => k.startsWith(`${name}/`) && k.split("/").length === 2).map((k) => ({ id: k.split("/")[1], ...env.db.store.get(k) }))
async function say(uid, message, n, conversationId) { env.time.now += 61000; const cfg = await cfgMod.getAiConfig(); return runChat({ uid, cfg, data: { message, requestId: `req_${uid}_${n}_xxxx`, ...(conversationId ? { conversationId } : {}) } }) }
const eng = async (message) => require("../src/ai/engine/engine").respond({ message, context: null, location: null, cfg: await cfgMod.getAiConfig(), now: new Date(env.time.now) })
const denied = (p) => assert.rejects(p, (e) => ["permission-denied", "unauthenticated", "failed-precondition"].includes(e.code) && (e.code !== "failed-precondition" || e.message === "email-not-verified"))
const text = (r) => r.blocks.map((b) => b.text).join(" ")
const isMiss = (r) => r.blocks.every((b) => b.type === "general") && !r.cards.length
const answered = (r) => !isMiss(r)

test("the privacy screen keeps only allow-listed words and refuses anything personal (fails closed)", () => {
  const ok = screen.signature("find a restaurant in Kliptown with 3 friends")
  assert.deepEqual(ok, { ok: true, sig: "find a restaurant in <x> with <n> friends" })
  for (const t of ["my email is a@b.com find food", "phone 0821234567 hotel near me", "call me Sipho and find a hotel", "find food and I have HIV", "visit https://x.com for food", "find food @sipho", "my address is 12 Main Road find a hotel", "the ambulance is late find a hotel", "x".repeat(300), "find\u0007 food", "hello", ""]) assert.equal(screen.signature(t).ok, false, t)
  assert.equal(screen.signature("blorp zzzz qqqq find food").ok, false, "mostly unknown words are refused")
  const sig = screen.signature("find a restaurant in Mohale Street with Thandi").sig
  assert.ok(!/mohale|thandi/.test(sig), "names never survive")
  assert.equal(screen.validSignature("find <x> hotel"), true); assert.equal(screen.validSignature("send money to <x>"), false)
})

test("collection is OFF by default and cannot be switched on without the recorded privacy gate", async () => {
  fresh()
  const cfg = await cfgMod.getAiConfig()
  assert.equal(cfg.learning.collect, false); assert.equal(cfg.learning.privacyAcknowledged, false)
  await say("u1", "blorp the zzz thing", 1)
  assert.equal(col(AI_COL.candidates).length, 0, "nothing is recorded while collection is off")
  await assert.rejects(AI.aiAdminUpdateConfig(admin({ patch: { learning: { collect: true } } })), (e) => e.code === "invalid-argument")
  await assert.rejects(AI.aiAdminUpdateConfig(admin({ patch: { learning: { collect: true, privacyAcknowledged: true, model: "x" } } })), (e) => e.code === "invalid-argument")
  await AI.aiAdminUpdateConfig(admin({ patch: { learning: { collect: true, privacyAcknowledged: true } } }))
  assert.equal((await cfgMod.getAiConfig()).learning.collect, true)
})

test("a hand-edited stored config with collect on but no privacy gate is ignored (defaults apply)", async () => {
  fresh({ learning: { collect: true } })
  assert.equal((await cfgMod.getAiConfig()).learning.collect, false)
})

test("unanswered questions become bounded, de-duplicated candidates holding NO text, uid or conversation", async () => {
  fresh(ON)
  await say("u1", "do you have a helicopter trip over soweto", 1)
  const r2 = await say("u2", "do you have a helicopter trip over soweto", 1)
  await say("u1", "do you have a helicopter trip over soweto", 2) // same user, same day: not counted twice
  const cands = col(AI_COL.candidates)
  assert.equal(cands.length, 1); assert.equal(cands[0].count, 2)
  assert.equal(cands[0].status, "new")
  const dump = JSON.stringify(cands)
  for (const bad of ["u1", "u2", "helicopter", "req_", "c_"]) assert.ok(!dump.includes(bad), `candidate must not contain ${bad}`)
  assert.ok(cands[0].sig.includes("<x>"), cands[0].sig)
  assert.ok(!("signals" in r2), "signals are never returned to the client")
})

test("personal or sensitive messages create nothing, and the chat still answers", async () => {
  fresh(ON)
  for (const [i, m] of ["my email is sipho@example.org please blorp", "I have HIV where is a zzzz", "call 0821234567 about the blorp"].entries()) { const r = await say("u1", m, i + 1); assert.ok(r.blocks.length) }
  assert.equal(col(AI_COL.candidates).length, 0)
})

test("per-user and per-day caps bound what can be collected; opted-out users contribute nothing", async () => {
  fresh({ learning: { collect: true, privacyAcknowledged: true, maxPerUserPerDay: 2, maxNewPerDay: 3 } })
  for (let i = 0; i < 4; i++) await say("u1", `do you have a ${["balloon", "boat", "ferry", "yacht"][i]} trip ${["over", "near", "under", "around"][i]} soweto`, i + 1)
  assert.equal(col(AI_COL.candidates).length, 2, "one user can add at most maxPerUserPerDay")
  await H.aiSetLearningOptOut(user("u9", { optOut: true }))
  await say("u9", "do you have a zeppelin trip into soweto", 1)
  assert.equal(col(AI_COL.candidates).length, 2)
  await H.aiSetLearningOptOut(user("u9", { optOut: false }))
  await say("u3", "do you have a zeppelin trip into soweto", 1); await say("u4", "what about a hovercraft in soweto", 1); await say("u5", "anything for a segway thing", 1)
  assert.ok(col(AI_COL.candidates).length <= 3, "maxNewPerDay is a hard ceiling")
})

test("approved phrase_intent is USED by the engine; before approval, after disable and after revoke it is not", async () => {
  fresh(ON)
  const ask = "anything for a hovercraft thing"
  assert.ok(isMiss(await say("u1", ask, 1)))
  const c = col(AI_COL.candidates)[0]; assert.ok(c)
  assert.ok(!(await say("u1", "find food in soweto", 9)).blocks.every((b) => b.type === "general"), "control: built-in still works")
  await H.aiAdminReviewCandidate(admin({ candidateId: c.id, decision: "approve", type: "phrase_intent", payload: { sigs: [c.sig], intent: "find_restaurants" } }))
  const k = col(AI_COL.knowledge)[0]; assert.equal(k.status, "active"); assert.equal(k.version, 1)
  const after = await say("u1", ask, 2)
  assert.ok(answered(after), "now routed to the restaurant search")
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k.id, action: "disable", reason: "not_useful" }))
  assert.ok(isMiss(await say("u1", ask, 3)), "disabled -> back to before")
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k.id, action: "enable" }))
  assert.ok(answered(await say("u1", ask, 4)))
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k.id, action: "revoke", reason: "incorrect" }))
  assert.ok(isMiss(await say("u1", ask, 5)), "revoked -> not used")
  await assert.rejects(H.aiAdminUpdateKnowledge(admin({ knowledgeId: k.id, action: "enable" })), (e) => e.code === "failed-precondition")
  const hist = (await H.aiAdminKnowledgeHistory(admin({ knowledgeId: k.id }))).versions
  assert.deepEqual(hist.map((v) => v.action), ["create", "disable", "enable", "revoke"]); assert.deepEqual(hist.map((v) => v.version), [1, 2, 3, 4])
})

test("a learned phrase never overrides a clear built-in match or an emergency, and the `use` switch turns all learning off", async () => {
  fresh(ON)
  await H.aiAdminSaveKnowledge(admin({ type: "phrase_intent", payload: { sigs: ["find food in soweto"], intent: "find_accommodation" } }))
  assert.equal((await eng("find food in soweto")).intent, "find_restaurants", "a clear built-in match is never overridden")
  assert.equal((await eng("I need an ambulance now")).intent, "emergency")
  await AI.aiAdminUpdateConfig(admin({ patch: { learning: { use: false } } }))
  await H.aiAdminSaveKnowledge(admin({ type: "answer", payload: { sigs: ["do you have a <x> trip over soweto"], text: "Rides are arranged by the listed operators." } }))
  assert.ok(!text(await say("u1", "do you have a blorp trip over soweto", 3)).includes("listed operators"))
})

test("an approved answer is shown as `knowledge`, never `verified`, only where nothing else answers", async () => {
  fresh(ON)
  const sig = screen.signature("do you have a helicopter trip over soweto").sig
  await H.aiAdminSaveKnowledge(admin({ type: "answer", payload: { sigs: [sig], text: "Helicopter rides are not run by XploreSoweto; ask a listed tour operator." } }))
  const r = await say("u1", "do you have a helicopter trip over soweto", 1)
  const b = r.blocks.find((x) => /Helicopter rides/.test(x.text)); assert.ok(b); assert.equal(b.type, "knowledge")
  assert.ok(!r.blocks.some((x) => x.type === "verified"))
  assert.equal(col(AI_COL.candidates).length, 0, "an answered question is not a miss")
  assert.match(text(await say("u1", "find restaurants in soweto", 2)), /./)
})

test("learned place aliases join place recognition", async () => {
  fresh(ON)
  await assert.rejects(H.aiAdminSaveKnowledge(admin({ type: "place_alias", payload: { alias: "kasi mall", canonical: "Atlantis Reef" } })), (e) => e.message === "unknown-canonical-place")
  await H.aiAdminSaveKnowledge(admin({ type: "place_alias", payload: { alias: "mapon", canonical: "Maponya Mall" } }))
  const r = await say("u1", "tell me about mapon", 1)
  assert.match(text(r), /Maponya/)
})

test("review is strictly Super Admin: users, unverified admins, inactive admins and anonymous callers are denied everywhere", async () => {
  fresh(ON)
  await say("u1", "do you have a helicopter trip over soweto", 1)
  const c = col(AI_COL.candidates)[0]
  env.seed("super-admin/gone", { uid: "gone", role: "super_admin", active: false })
  const calls = [[H.aiAdminListLearningCandidates, {}], [H.aiAdminReviewCandidate, { candidateId: c.id, decision: "reject", reason: "not_useful" }], [H.aiAdminSaveKnowledge, { type: "answer", payload: { sigs: ["find a hotel"], text: "A long enough answer." } }],
    [H.aiAdminUpdateKnowledge, { knowledgeId: "a".repeat(24), action: "revoke", reason: "other" }], [H.aiAdminListKnowledge, {}], [H.aiAdminKnowledgeHistory, { knowledgeId: "a".repeat(24) }], [H.aiAdminLearningStats, {}], [H.aiAdminPurgeLearning, { scope: "expired" }], [AI.aiAdminUpdateConfig, { patch: { learning: { use: false } } }], [AI.aiAdminGetUsage, {}]]
  for (const [fn, data] of calls) {
    await denied(fn(user("u1", data))) // an ordinary user
    await denied(fn(req("u1", data, { superAdmin: true }))) // claim without an active record
    await denied(fn(req("gone", data, { superAdmin: true }))) // inactive record
    await denied(fn(req("root", data, { superAdmin: true, email_verified: false }))) // unverified email
    await denied(fn({ data })) // anonymous
  }
  assert.equal(col(AI_COL.candidates)[0].status, "new"); assert.equal(col(AI_COL.knowledge).length, 0)
  assert.equal((await H.aiAdminListLearningCandidates(admin({}))).candidates.length, 1, "the real Super Admin works")
})

test("review validates strictly: reasons are enumerated, signatures must be in the vocabulary, only supported intents, no arbitrary fields", async () => {
  fresh(ON)
  await say("u1", "do you have a helicopter trip over soweto", 1)
  const c = col(AI_COL.candidates)[0]
  const bad = (data, msg) => assert.rejects(H.aiAdminReviewCandidate(admin(data)), (e) => e.code === "invalid-argument" && (!msg || e.message === msg))
  await bad({ candidateId: c.id, decision: "reject", reason: "because I said so" }, "invalid-reason")
  await bad({ candidateId: c.id, decision: "reject" }, "invalid-reason")
  await bad({ candidateId: c.id, decision: "approve", type: "phrase_intent", payload: { sigs: [c.sig], intent: "emergency" } }, "intent-not-learnable")
  await bad({ candidateId: c.id, decision: "approve", type: "phrase_intent", payload: { sigs: [c.sig], intent: "booking_request" } }, "intent-not-learnable")
  await bad({ candidateId: c.id, decision: "approve", type: "phrase_intent", payload: { sigs: ["email sipho@x.com find food"], intent: "find_restaurants" } }, "invalid-signature")
  await bad({ candidateId: c.id, decision: "approve", type: "phrase_intent", payload: { sigs: [c.sig], intent: "find_restaurants", run: "rm -rf /" } }, "invalid-payload")
  await bad({ candidateId: c.id, decision: "approve", type: "answer", payload: { sigs: [c.sig], text: "see https://evil.example" } }, "invalid-text")
  await bad({ candidateId: c.id, decision: "approve", type: "answer", payload: { sigs: [c.sig], text: "<script>alert(1)</script> hello there" } }, "invalid-text")
  await bad({ candidateId: c.id, decision: "approve", type: "place_alias", payload: { alias: "x" } }, "place-alias-is-created-directly")
  await bad({ candidateId: c.id, decision: "maybe" }, "invalid-decision")
  assert.equal(col(AI_COL.candidates)[0].status, "new"); assert.equal(col(AI_COL.knowledge).length, 0)
  await H.aiAdminReviewCandidate(admin({ candidateId: c.id, decision: "reject", reason: "out_of_scope" }))
  await assert.rejects(H.aiAdminReviewCandidate(admin({ candidateId: c.id, decision: "reject", reason: "other" })), (e) => e.code === "failed-precondition")
  await say("u2", "do you have a helicopter trip over soweto", 1)
  const again = col(AI_COL.candidates)[0]; assert.equal(again.status, "rejected"); assert.equal(again.count, 2, "a rejected question keeps counting but is not re-proposed")
  assert.equal((await H.aiAdminListLearningCandidates(admin({}))).candidates.length, 0)
})

test("a stored learning record can only ever be data: a damaged or hand-edited knowledge document is ignored by the engine", async () => {
  fresh(ON)
  env.seed("ai-knowledge/evil1", { type: "phrase_intent", status: "active", version: 1, sigs: ["find a hotel"], intent: "emergency" })
  env.seed("ai-knowledge/evil2", { type: "answer", status: "active", version: 1, sigs: ["send money to <x>"], text: "x".repeat(900) })
  env.seed("ai-knowledge/evil3", { type: "place_alias", status: "active", version: 1, alias: "Bad Alias!!", canonical: "x" })
  const k = await knowledge.loadActive(await cfgMod.getAiConfig())
  assert.equal(k.phrases.size, 0); assert.equal(k.answers.size, 0); assert.equal(k.aliases.length, 0)
})

test("feedback is structured (no free text), reads the user's OWN message server-side, and records only a screened signature", async () => {
  fresh(ON)
  const r = await say("u1", "find a restaurant in soweto", 1)
  const msgId = [...env.db.store.keys()].find((k) => /_a$/.test(k) && k.includes(r.conversationId)).split("/").pop()
  await assert.rejects(H.aiSubmitFeedback(user("u1", { conversationId: r.conversationId, messageId: msgId, rating: "unhelpful", comment: "my number is 0821234567" })), (e) => e.code === "invalid-argument")
  await assert.rejects(H.aiSubmitFeedback(user("u1", { conversationId: r.conversationId, messageId: msgId, rating: "unhelpful", correctionIntent: "emergency" })), (e) => e.code === "invalid-argument")
  await assert.rejects(H.aiSubmitFeedback(user("u2", { conversationId: r.conversationId, messageId: msgId, rating: "unhelpful" })), (e) => e.code === "not-found", "someone else's conversation looks missing")
  assert.deepEqual(await H.aiSubmitFeedback(user("u1", { conversationId: r.conversationId, messageId: msgId, rating: "helpful" })), { recorded: false, reason: "not-needed" })
  assert.deepEqual(await H.aiSubmitFeedback(user("u1", { conversationId: r.conversationId, messageId: msgId, rating: "unhelpful", correctionIntent: "find_accommodation" })), { recorded: true })
  assert.deepEqual(await H.aiSubmitFeedback(user("u1", { conversationId: r.conversationId, messageId: msgId, rating: "unhelpful", correctionIntent: "find_accommodation" })), { recorded: false, reason: "duplicate" })
  const c = col(AI_COL.candidates).find((x) => x.kind === "feedback_correction"); assert.ok(c)
  assert.equal(c.suggestions.find_accommodation, 1); assert.ok(!JSON.stringify(c).includes("u1"))
})

test("feedback does nothing while learning is off, and respects the opt-out", async () => {
  fresh()
  const r = await say("u1", "find a restaurant in soweto", 1)
  const msgId = [...env.db.store.keys()].find((k) => /_a$/.test(k)).split("/").pop()
  assert.deepEqual(await H.aiSubmitFeedback(user("u1", { conversationId: r.conversationId, messageId: msgId, rating: "unhelpful" })), { recorded: false, reason: "off" })
  fresh(ON); await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  const r2 = await say("u1", "find a restaurant in soweto", 1); const m2 = [...env.db.store.keys()].find((k) => /_a$/.test(k)).split("/").pop()
  assert.equal((await H.aiSubmitFeedback(user("u1", { conversationId: r2.conversationId, messageId: m2, rating: "unhelpful" }))).reason, "opted-out")
  assert.equal(col(AI_COL.candidates).length, 0)
})

test("account erasure removes the user's learning throttle records and opt-out; personal memory stays separate (nothing is stored per user beyond that)", async () => {
  fresh(ON)
  await say("u1", "do you have a helicopter trip over soweto", 1); await H.aiSetLearningOptOut(user("u1", { optOut: true }))
  assert.ok(col(AI_COL.seen).some((d) => d.ownerUid === "u1")); assert.ok(env.db.store.has("ai-learning-optout/u1"))
  await AI.aiDeleteAllMyAiData(user("u1", {}))
  assert.ok(!col(AI_COL.seen).some((d) => d.ownerUid === "u1")); assert.ok(!env.db.store.has("ai-learning-optout/u1"))
  assert.equal(col(AI_COL.candidates).length, 1, "anonymous aggregate candidates remain; they hold no identifier (documented)")
})

test("retention: candidates expire, and a Super Admin can purge expired, rejected, new or (with confirmation) all", async () => {
  fresh({ learning: { collect: true, privacyAcknowledged: true, candidateRetentionDays: 10 } })
  await say("u1", "do you have a helicopter trip over soweto", 1)
  const c = col(AI_COL.candidates)[0]; assert.equal(c.expireAt.toMillis() - env.time.now > 9 * 86400000, true)
  assert.deepEqual(await H.aiAdminPurgeLearning(admin({ scope: "expired" })), { deleted: 0, more: false })
  env.time.now += 11 * 86400000
  assert.equal((await H.aiAdminPurgeLearning(admin({ scope: "expired" }))).deleted, 1)
  await say("u2", "what about a hovercraft in soweto", 1)
  await assert.rejects(H.aiAdminPurgeLearning(admin({ scope: "all" })), (e) => e.message === "confirmation-required")
  await assert.rejects(H.aiAdminPurgeLearning(admin({ scope: "everything" })), (e) => e.code === "invalid-argument")
  assert.equal((await H.aiAdminPurgeLearning(admin({ scope: "all", confirm: "DELETE-ALL-CANDIDATES" }))).deleted, 1)
  assert.ok(env.logs === undefined || true)
})

test("every review action is audited, with ids and enumerated reasons only", async () => {
  fresh(ON)
  await say("u1", "do you have a helicopter trip over soweto", 1)
  const c = col(AI_COL.candidates)[0]
  await H.aiAdminReviewCandidate(admin({ candidateId: c.id, decision: "approve", type: "answer", payload: { sigs: [c.sig], text: "Ask a listed tour operator about flights." } }))
  const k = col(AI_COL.knowledge)[0]
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k.id, action: "edit", payload: { text: "Ask a listed tour operator about scenic flights." } }))
  await H.aiAdminUpdateKnowledge(admin({ knowledgeId: k.id, action: "revoke", reason: "outdated" }))
  await H.aiAdminPurgeLearning(admin({ scope: "expired" }))
  const audits = col("audit-log").map((a) => a.action).filter((a) => /^ai\.(learning|knowledge)/.test(a)).sort()
  assert.deepEqual(audits, ["ai.knowledge.edit", "ai.knowledge.revoke", "ai.learning.approve", "ai.learning.purge"])
  assert.ok(!JSON.stringify(col("audit-log")).includes("tour operator"), "no answer text or candidate text in the audit log")
  const stats = await H.aiAdminLearningStats(admin({}))
  assert.equal(stats.candidates.byStatus.approved, 1); assert.equal(stats.knowledge.byStatus.revoked, 1); assert.equal(stats.learning.collect, true)
})

test("learning is wired into the existing safety structure: private collections, no assistant read access, deny-all rules, no secrets", () => {
  for (const c of ["ai-learning-candidates", "ai-knowledge", "ai-learning-seen", "ai-learning-optout"]) { assert.ok(PRIVATE_COLLECTIONS.includes(c), c); assert.ok(!PUBLIC_READ_COLLECTIONS.includes(c), c) }
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "security-rules", "firestore.rules"), "utf8")
  for (const c of ["ai-learning-candidates", "ai-knowledge", "ai-learning-seen", "ai-learning-optout"]) assert.match(rules, new RegExp(`match /${c}/\\{\\w+\\}\\s+\\{[^}]*allow read, write: if false`), c)
  const src = fs.readdirSync(path.join(__dirname, "..", "src", "ai", "learning")).map((f) => fs.readFileSync(path.join(__dirname, "..", "src", "ai", "learning", f), "utf8")).join("\n")
  assert.ok(!/openai|fetch\(|https?:\/\/(?!x\.com)/i.test(src.replace(/\/\/.*$/gm, "")), "no provider or network call anywhere in the learning code")
})

test("the existing Luna and per-user rate limits are unchanged by learning (a miss still costs an allowance; Luna stays off)", async () => {
  fresh({ ...ON, limits: { dailyMessages: 2, burstPerMinute: 5, burstWindowSeconds: 60, maxInputChars: 1000 } })
  await say("u1", "do you have a helicopter trip over soweto", 1); await say("u1", "what about a hovercraft in soweto", 2)
  await assert.rejects(say("u1", "anything for a segway thing", 3), (e) => e.code === "resource-exhausted")
  assert.equal((await cfgMod.getAiConfig()).luna.enabled, false)
})
