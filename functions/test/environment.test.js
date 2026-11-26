"use strict"
// Staging foundation, group A: exact project identity, the function manifests, and the guarantee that staging never calls a provider.
// No network, no key, no Firebase project is touched: the manifest is produced locally by the Functions SDK's own discovery binary.
const { test, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const E = require("../src/lib/environment")
const CFG = require("../../config/environments")
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "manifest.production.json"), "utf8"))
const BIN = path.join(__dirname, "..", "node_modules", "firebase-functions", "lib", "bin", "firebase-functions.js")
const FUNCTIONS_DIR = path.join(__dirname, "..")

const clean = (over = {}) => { const e = { ...process.env }; for (const k of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "FIREBASE_CONFIG", "OPENAI_API_KEY"]) delete e[k]; return { ...e, ...over } }

test("project ids in the functions folder equal the single source of truth", () => {
  assert.equal(E.PRODUCTION_PROJECT, CFG.ENVIRONMENTS.production.projectId)
  assert.equal(E.STAGING_PROJECT, CFG.ENVIRONMENTS.staging.projectId)
  assert.ok(E.RETIRED_PROJECTS.length >= 1 && !JSON.stringify(CFG).includes(E.RETIRED_PROJECTS[0]))
  assert.equal(CFG.ENVIRONMENTS.production.region, "africa-south1"); assert.equal(CFG.ENVIRONMENTS.staging.region, "africa-south1")
})
test("staging is recognised by EXACT project id only, never by a suffix", () => {
  const st = (v) => E.isStaging({ GCLOUD_PROJECT: v })
  assert.equal(st("xploresoweto-staging"), true)
  for (const v of ["xploresoweto", "other-staging", "xploresoweto-staging2", "xploresoweto-staging-2", "Xploresoweto-Staging", "staging", "", "the-steady-hotel"]) assert.equal(st(v), false, v)
  assert.equal(E.isStaging({}), false)
})
test("contradictory indicators cannot switch the staging protections off", () => {
  assert.equal(E.isStaging({ GCLOUD_PROJECT: "xploresoweto", GOOGLE_CLOUD_PROJECT: "xploresoweto-staging" }), true)
  assert.equal(E.isStaging({ FIREBASE_CONFIG: JSON.stringify({ projectId: "xploresoweto-staging" }) }), true)
  assert.equal(E.isStaging({ FIREBASE_CONFIG: "not json" }), false)
  assert.equal(E.isProduction({ GCLOUD_PROJECT: "xploresoweto", GOOGLE_CLOUD_PROJECT: "xploresoweto-staging" }), false)
  assert.equal(E.isProduction({ GCLOUD_PROJECT: "xploresoweto" }), true); assert.equal(E.isProduction({}), false)
})
test("limits: staging 3 instances, production and unknown targets 10; the provider secret binds everywhere except exact staging", () => {
  assert.equal(E.maxInstances({ GCLOUD_PROJECT: "xploresoweto-staging" }), 3)
  for (const env of [{ GCLOUD_PROJECT: "xploresoweto" }, {}, { GCLOUD_PROJECT: "something-else" }]) { assert.equal(E.maxInstances(env), 10); assert.equal(E.bindProviderSecret(env), true); assert.equal(E.lunaBlocked(env), false) }
  assert.equal(E.bindProviderSecret({ GCLOUD_PROJECT: "xploresoweto-staging" }), false); assert.equal(E.lunaBlocked({ GCLOUD_PROJECT: "xploresoweto-staging" }), true)
})

// ---- manifests (what `firebase deploy` would be told to create), generated offline by the SDK
function manifest(env) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xs-manifest-")), "m.json")
  const r = spawnSync(process.execPath, [BIN, FUNCTIONS_DIR], { env: clean({ ...env, FUNCTIONS_MANIFEST_OUTPUT_PATH: out }), encoding: "utf8", timeout: 60000 })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(fs.readFileSync(out, "utf8"))
}
// The 10 reviewed-learning callables added after the golden manifest was taken. Everything else must still match it exactly.
const LEARNING = ["aiSubmitFeedback", "aiSetLearningOptOut", "aiAdminListLearningCandidates", "aiAdminReviewCandidate", "aiAdminSaveKnowledge", "aiAdminUpdateKnowledge", "aiAdminListKnowledge", "aiAdminKnowledgeHistory", "aiAdminLearningStats", "aiAdminPurgeLearning"]
const original = (m) => { const c = JSON.parse(JSON.stringify(m)); for (const n of LEARNING) delete c.endpoints[n]; return c }
const bound = (m) => Object.entries(m.endpoints).filter(([, e]) => (e.secretEnvironmentVariables || []).length).map(([n]) => n)
test("PRODUCTION REGRESSION: the production manifest is identical to the one generated from the unmodified c419086 code", () => {
  const m = manifest({ GCLOUD_PROJECT: "xploresoweto" })
  assert.deepEqual(original(m), GOLDEN)
  assert.equal(Object.keys(m.endpoints).length, 40); assert.deepEqual(bound(m), ["aiChat"]) // still ONLY aiChat binds a secret; the 10 new callables bind none
  assert.deepEqual(Object.keys(m.endpoints).filter((n) => !GOLDEN.endpoints[n]).sort(), [...LEARNING].sort())
  assert.ok(Object.values(m.endpoints).every((e) => e.maxInstances === 10 && e.region[0] === "africa-south1"))
})
test("an unknown or missing project keeps today's behaviour (secret bound, 10 instances): a staging deploy cannot lose the binding by accident, a wrong target fails loudly", () => {
  assert.deepEqual(original(manifest({})), GOLDEN); assert.deepEqual(original(manifest({ GCLOUD_PROJECT: "xploresoweto-staging-2" })), GOLDEN)
})
test("STAGING: all 30 original functions remain (plus the 10 learning callables), none binds a secret, none declares one, every function is capped at 3 instances, nothing else differs", () => {
  const m = manifest({ GCLOUD_PROJECT: "xploresoweto-staging" })
  assert.deepEqual(Object.keys(original(m).endpoints), Object.keys(GOLDEN.endpoints)); assert.equal(Object.keys(m.endpoints).length, 40)
  assert.deepEqual(bound(m), []); assert.ok(!JSON.stringify(m).includes("OPENAI_API_KEY"))
  assert.ok(Object.values(m.endpoints).every((e) => e.maxInstances === 3 && e.region[0] === "africa-south1"))
  const back = original(m)
  for (const e of Object.values(back.endpoints)) e.maxInstances = 10
  back.endpoints.aiChat.secretEnvironmentVariables = GOLDEN.endpoints.aiChat.secretEnvironmentVariables; back.params = GOLDEN.params
  assert.deepEqual(back, GOLDEN) // the ONLY differences are maxInstances, aiChat's secret binding and the secret's declaration
})
test("every AI callable the app uses is exported in both environments", () => {
  for (const n of ["aiChat", "aiListConversations", "aiGetConversation", "aiDeleteConversation", "aiDeleteAllMyAiData", "aiGetUsage", "aiAdminGetUsage", "aiAdminUpdateConfig", "aiSetLunaConsent"]) {
    assert.ok(GOLDEN.endpoints[n], n); assert.ok(manifest({ GCLOUD_PROJECT: "xploresoweto-staging" }).endpoints[n], n)
  }
})

// ---- zero provider calls in staging, through the REAL handlers
const F = require("./engine_fixture")
const { req } = require("./helpers")
const H = require("../src/handlers/ai")
const luna = require("../src/ai/luna")
const provider = require("../src/ai/luna/provider")
const prompt = require("../src/ai/luna/prompt")
const manifestOk = () => ({ status: "calibrated", reasoningEffort: "none", payloads: Object.fromEntries(prompt.allPayloads().map((p) => [p.id, { sha256: p.sha256, inputTokens: 400 }])) })
let env, calls, fetches, saved
beforeEach(() => {
  saved = { gp: process.env.GCLOUD_PROJECT, key: process.env.OPENAI_API_KEY, fetch: globalThis.fetch }
  env = F.setupWorld(); require("../src/ai/luna/breaker").resetLocalForTests(); calls = []; fetches = []
  globalThis.fetch = async (...a) => { fetches.push(a); throw new Error("network must not be reached") }
})
afterEach(() => {
  luna.setDepsForTests({}); globalThis.fetch = saved.fetch
  for (const [k, v] of [["GCLOUD_PROJECT", saved.gp], ["OPENAI_API_KEY", saved.key]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})
const THANKS = "You're welcome! Ask me anything else about Soweto."
test("STAGING: Luna enabled + consent + a key injected + dependencies that would answer -> ZERO provider calls and the deterministic wording is returned", async () => {
  process.env.GCLOUD_PROJECT = "xploresoweto-staging"; process.env.OPENAI_API_KEY = "injected-by-mistake-for-this-test"
  luna.setDepsForTests({ manifest: manifestOk(), hasKey: () => true, callResponses: async (a) => { calls.push(a); return { ok: true, text: JSON.stringify({ segments: { all: "REWRITTEN" } }), usage: { input: 1, output: 1, cached: 0, reasoning: 0 }, ms: 1 } } })
  env.seed("ai-config/default", { luna: { enabled: true } })
  await H.aiSetLunaConsent(req("u1", { action: "accept", noticeVersion: 1 }))
  const r = await H.aiChat(req("u1", { message: "thanks!", requestId: "req-staging-0001", aiNoticeVersion: 1 }))
  assert.equal(r.blocks.map((b) => b.text).join(""), THANKS)
  assert.equal(calls.length, 0); assert.equal(fetches.length, 0)
  assert.equal(env.list("ai-usage").filter((d) => d.id.startsWith("luna_")).length, 0) // not even a usage reservation was written
  assert.equal((await luna.tryRewrite({ uid: "u1", requestId: "req-staging-0002", cfg: { luna: { enabled: true } }, intent: "thanks", blocks: [{ type: "verified", text: THANKS }], language: "en", noticeVersion: 1 })).skipped, "environment-blocked")
})
test("STAGING: the real provider code refuses before the network even with an explicit key and a working fetch", async () => {
  process.env.GCLOUD_PROJECT = "xploresoweto-staging"; process.env.OPENAI_API_KEY = "injected-by-mistake-for-this-test"
  assert.equal(provider.hasKey(), false)
  let spy = 0
  const r = await provider.callResponses({ payload: prompt.buildPayload("thanks", "en"), maxOutputTokens: 500, timeoutMs: 1000, apiKey: "explicit-for-this-test", fetchImpl: async () => { spy += 1; return { ok: true } } })
  assert.equal(spy, 0); assert.equal(r.ok, false); assert.equal(r.noKey, true); assert.equal(r.blockedByEnvironment, true)
})
test("PRODUCTION REGRESSION: outside staging the provider path is unchanged (a key is readable; an unknown project is not staging)", async () => {
  process.env.OPENAI_API_KEY = "present-for-this-test"; delete process.env.GCLOUD_PROJECT
  assert.equal(provider.hasKey(), true)
  process.env.GCLOUD_PROJECT = "xploresoweto"; assert.equal(provider.hasKey(), true)
  let spy = 0
  const r = await provider.callResponses({ payload: prompt.buildPayload("thanks", "en"), maxOutputTokens: 500, timeoutMs: 1000, apiKey: "explicit-for-this-test", fetchImpl: async () => { spy += 1; return { ok: false, status: 401, json: async () => ({}), headers: { get: () => null } } } })
  assert.equal(spy, 1); assert.equal(r.kind, "auth"); assert.ok(!r.blockedByEnvironment)
})
