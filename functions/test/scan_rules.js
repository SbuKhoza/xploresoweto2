"use strict"
// The matching rules of the "no AI provider / no outbound network / no key" safety scans, as PURE functions. The scans in ai_security.test.js,
// ai-client.test.js and malloya_acceptance.test.js call these on the real repository; scan_meta.test.js feeds them deliberately forbidden code to
// prove they still catch it. Rules are deliberately specific: the only things allowed are the optional Luna wording layer's own files.
const SCOPE = /^(functions\/(src|index\.js)|firebase\.json|security-rules\/|app\/|components\/|screens\/|utils\/|App\.js)/ // same scope as the original scan
const OTHER_PROVIDER = /anthropic|ANTHROPIC_API_KEY|gemini|generativelanguage|vertexai|cohere|mistral|langchain|ollama/i // forbidden EVERYWHERE, no exception
const OPENAI = /openai/i // covers OPENAI_API_KEY and api.openai.com
const SECRET_BINDING = /defineSecret|secrets:\s*\[/ // a secret may be declared/bound ONLY in functions/index.js
const NETWORK = /\bfetch\(|globalThis\.fetch|require\(["'](node:)?(https?|net|tls|dgram|http2)["']\)|axios|node-fetch|XMLHttpRequest|WebSocket/
const NETWORK_LIBS = /require\(["'](node:)?(https?|net|tls|dgram|http2)["']\)|axios|node-fetch|XMLHttpRequest|WebSocket/ // never allowed, not even in provider.js
const PROVIDER_FILE = "functions/src/ai/luna/provider.js" // the ONE backend file that may use the network
const NOTICE_FILE = "utils/ai/notice.js" // the ONE app file that may NAME the provider (the notice must say who)
const DEP = /@anthropic-ai|"openai"|@google\/generative-ai|@google-cloud\/vertexai|"cohere-ai"|"@mistralai|langchain|"ollama"/i
const KEY_SHAPED = /sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{30,}/
const openaiAllowed = (rel) => rel === "functions/index.js" || rel.startsWith("functions/src/ai/luna/") || rel === NOTICE_FILE

// entries: [{ rel, text }] -> [{ rel, why }]
function providerProblems(entries) {
  const out = []
  for (const { rel, text } of entries.filter((e) => SCOPE.test(e.rel))) {
    if (OTHER_PROVIDER.test(text)) out.push({ rel, why: "other-provider" })
    if (OPENAI.test(text) && !openaiAllowed(rel)) out.push({ rel, why: "openai-outside-luna" })
    if (SECRET_BINDING.test(text) && rel !== "functions/index.js") out.push({ rel, why: "secret-outside-index" })
  }
  return out
}
function networkProblems(entries) { // entries: the backend AI files (functions/src/ai/**)
  const out = []
  for (const { rel, text } of entries) {
    if (rel === PROVIDER_FILE) { if (NETWORK_LIBS.test(text)) out.push({ rel, why: "network-library" }); if (/https?:\/\/[a-z]/i.test(text.replace(/^\s*\/\/.*$/gm, ""))) out.push({ rel, why: "hard-coded-endpoint" }) }
    else if (NETWORK.test(text)) out.push({ rel, why: "network-outside-provider" })
  }
  return out
}
function secretBindingProblems(indexText) { // functions/index.js: exactly one secret, bound to aiChat only
  const p = []
  if ((indexText.match(/defineSecret\(/g) || []).length !== 1) p.push("not-exactly-one-secret")
  if ((indexText.match(/secrets:\s*\[/g) || []).length !== 1) p.push("not-exactly-one-binding")
  if (!/aiChat: withOpenAiKey\(ai\.aiChat\)/.test(indexText)) p.push("aiChat-not-bound")
  if ((indexText.match(/withOpenAiKey\(/g) || []).length !== 1) p.push("wrapper-used-elsewhere")
  return p
}
function appProviderProblems(entries) { // the app: nothing names a provider, except the notice (which still may not carry a key, URL or another provider)
  const out = []
  for (const { rel, text } of entries) {
    if (rel === NOTICE_FILE) { if (OTHER_PROVIDER.test(text) || /api[_-]?key|api\.openai|https?:|sk-|fetch\(/i.test(text)) out.push({ rel, why: "notice-carries-more-than-the-name" }) }
    else if (/anthropic|openai|gemini|api[_-]?key/i.test(text)) out.push({ rel, why: "provider-in-app" })
  }
  return out
}
module.exports = { SCOPE, DEP, KEY_SHAPED, PROVIDER_FILE, NOTICE_FILE, providerProblems, networkProblems, secretBindingProblems, appProviderProblems }
