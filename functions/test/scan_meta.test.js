"use strict"
// Proof that the revised safety scans still CATCH forbidden provider code. Each sample is code a future change might add; each must be flagged.
// (The samples are strings in memory; nothing here is written to the repository.)
const { test } = require("node:test")
const assert = require("node:assert/strict")
const R = require("./scan_rules")
const caught = (rel, text, why) => assert.ok(R.providerProblems([{ rel, text }]).some((p) => p.why === why), `${rel} should be flagged as ${why}`)

test("provider scan: another provider is flagged everywhere, even inside the Luna files", () => {
  caught("functions/src/ai/engine/engine.js", 'const Anthropic = require("@anthropic-ai/sdk")', "other-provider")
  caught("functions/src/ai/luna/index.js", "// fall back to gemini when OpenAI is down", "other-provider")
  caught("functions/src/handlers/ai.js", 'fetch("https://api.anthropic.com/v1/messages")', "other-provider")
  caught("screens/SowetoAI.js", "const key = ANTHROPIC_API_KEY", "other-provider")
  caught("utils/ai/notice.js", "uses Gemini", "other-provider")
})
test("provider scan: OpenAI outside the Luna files, the notice and index.js is flagged (engine, handlers, config, app screens, rules, firebase.json)", () => {
  for (const rel of ["functions/src/ai/engine/engine.js", "functions/src/ai/chat.js", "functions/src/ai/config.js", "functions/src/ai/consent.js", "functions/src/handlers/ai.js", "functions/src/handlers/profile.js",
    "screens/SowetoAI.js", "screens/Home.js", "utils/ai/aiClient.js", "App.js", "firebase.json", "security-rules/firestore.rules"]) {
    caught(rel, 'import OpenAI from "openai"', "openai-outside-luna"); caught(rel, 'const url = "https://api.openai.com/v1/responses"', "openai-outside-luna"); caught(rel, "process.env.OPENAI_API_KEY", "openai-outside-luna")
  }
  assert.deepEqual(R.providerProblems([{ rel: "functions/src/ai/luna/provider.js", text: 'const k = process.env.OPENAI_API_KEY // OpenAI' }]), []) // the allowed place, for contrast
})
test("provider scan: a secret declared or bound anywhere except functions/index.js is flagged, including inside the Luna files", () => {
  caught("functions/src/ai/luna/provider.js", 'const { defineSecret } = require("firebase-functions/params")', "secret-outside-index")
  caught("functions/src/handlers/ai.js", "onCall({ secrets: [KEY] }, h)", "secret-outside-index")
  caught("functions/src/ai/engine/x.js", 'defineSecret("ANYTHING")', "secret-outside-index")
})
test("secret binding: a second binding, a second secret, or the wrapper on any other function is flagged", () => {
  const ok = 'const K = defineSecret("OPENAI_API_KEY")\nconst withOpenAiKey = (h) => onCall({ ...opts, secrets: [K] }, h)\nmodule.exports = { aiChat: withOpenAiKey(ai.aiChat), aiGetUsage: wrap(ai.aiGetUsage) }'
  assert.deepEqual(R.secretBindingProblems(ok), [])
  assert.ok(R.secretBindingProblems(ok + '\nconst B = defineSecret("OTHER")').includes("not-exactly-one-secret"))
  assert.ok(R.secretBindingProblems(ok + "\nconst z = onCall({ secrets: [K] }, h)").includes("not-exactly-one-binding"))
  assert.ok(R.secretBindingProblems(ok.replace("aiGetUsage: wrap(ai.aiGetUsage)", "aiGetUsage: withOpenAiKey(ai.aiGetUsage)")).includes("wrapper-used-elsewhere"))
  assert.ok(R.secretBindingProblems(ok.replace("aiChat: withOpenAiKey(ai.aiChat)", "aiChat: wrap(ai.aiChat)")).includes("aiChat-not-bound"))
})
test("network scan: fetch, http(s), axios, sockets are flagged in every backend AI file except provider.js; provider.js may not use a network library or hard-code an endpoint", () => {
  const bad = ['await fetch("https://example.com")', "await globalThis.fetch(u)", 'const https = require("https")', 'require("node:net")', 'const axios = require("axios")', 'require("node-fetch")', "new WebSocket(u)", "new XMLHttpRequest()"]
  for (const rel of ["functions/src/ai/engine/engine.js", "functions/src/ai/retrieval/data.js", "functions/src/ai/chat.js", "functions/src/ai/consent.js", "functions/src/ai/luna/index.js", "functions/src/ai/luna/validate.js", "functions/src/ai/luna/usage.js", "functions/src/ai/luna/breaker.js"])
    for (const text of bad) assert.ok(R.networkProblems([{ rel, text }]).some((p) => p.why === "network-outside-provider"), `${rel}: ${text}`)
  for (const text of ['require("https")', 'const axios = require("axios")', "new WebSocket(u)", 'require("node:net")']) assert.ok(R.networkProblems([{ rel: R.PROVIDER_FILE, text }]).some((p) => p.why === "network-library"), text)
  assert.ok(R.networkProblems([{ rel: R.PROVIDER_FILE, text: 'const u = "https://evil.example.com/collect"' }]).some((p) => p.why === "hard-coded-endpoint"))
  assert.deepEqual(R.networkProblems([{ rel: R.PROVIDER_FILE, text: "const doFetch = fetchImpl || globalThis.fetch; await doFetch(ENDPOINT, init)" }]), []) // what provider.js legitimately does
})
test("app scan: the app may not name a provider or carry a key; the notice may name OpenAI only, never a key, URL, call or another provider", () => {
  const p = (rel, text) => R.appProviderProblems([{ rel, text }])
  for (const text of ['import OpenAI from "openai"', "const apiKey = 'x'", "api_key", "Anthropic", "Gemini"]) assert.equal(p("screens/SowetoAI.js", text).length, 1, text), assert.equal(p("utils/ai/aiClient.js", text).length, 1, text)
  assert.deepEqual(p(R.NOTICE_FILE, "Malloya may use OpenAI's GPT-6 Luna"), [])
  for (const text of ["https://api.openai.com/v1/responses", "apiKey", "fetch(url)", "Gemini", "Anthropic", "sk-abc"]) assert.equal(p(R.NOTICE_FILE, text).length, 1, text)
})
test("key scan and dependency scan: key-shaped strings and provider SDK dependencies are flagged", () => {
  assert.match("x " + "sk-" + "A".repeat(40), R.KEY_SHAPED); assert.match("sk-ant-" + "a".repeat(20), R.KEY_SHAPED) // built at runtime so this file contains no key-shaped string
  for (const dep of ['"openai": "^5.0.0"', '"@anthropic-ai/sdk": "1"', '"@google/generative-ai": "1"', '"langchain": "1"']) assert.match(`{ "dependencies": { ${dep} } }`, R.DEP, dep)
})
