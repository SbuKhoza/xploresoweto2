"use strict"
// Static guarantees about the AI feature. These read the repository, so they keep protecting it after later edits.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const R = require("./scan_rules")
const ROOT = path.resolve(__dirname, "..", "..")
const SKIP = new Set(["node_modules", ".git", "android", "ios", ".expo", "dist", "build", ".firebase"])
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/")
const files = walk(ROOT).filter((p) => !/\.(png|jpe?g|gif|webp|ttf|otf|ico|mp4|patch)$/i.test(p) && fs.statSync(p).size < 2_000_000)
const read = (p) => fs.readFileSync(p, "utf8")
const AI = path.join(ROOT, "functions", "src", "ai")
const aiFiles = walk(AI).filter((p) => p.endsWith(".js"))

// ---------------------------------------------------------------- no external AI provider, no key, no outbound network
test("no Anthropic/OpenAI (or other LLM) dependency exists in any package.json or lock file", () => {
  for (const p of files.filter((f) => /(^|\/)package(-lock)?\.json$/.test(rel(f)))) assert.doesNotMatch(read(p), R.DEP, rel(p))
})
// The optional Luna wording layer is the ONLY place the provider may be named (rules in scan_rules.js; scan_meta.test.js proves they still catch forbidden code):
//   * other providers: nowhere.  * "openai"/OPENAI_API_KEY: only functions/index.js, functions/src/ai/luna/**, utils/ai/notice.js.
//   * defineSecret / secrets: only functions/index.js.
const entriesOf = (pred) => files.map((p) => ({ rel: rel(p), text: read(p) })).filter((e) => pred(e.rel))
test("no runtime code or configuration mentions an LLM provider or an API-key secret, except the Luna files and the notice text", () => {
  assert.deepEqual(R.providerProblems(entriesOf(() => true)), [])
})
test("the OpenAI secret is declared once, in functions/index.js, and bound to aiChat ONLY", () => {
  assert.deepEqual(R.secretBindingProblems(read(path.join(ROOT, "functions", "index.js"))), [])
  const onlyLuna = files.filter((p) => /OPENAI_API_KEY/.test(read(p))).map(rel).filter((r) => !/^(functions\/(index\.js|src\/ai\/luna\/|scripts\/luna-calibrate\.js|test\/)|docs\/)/.test(r))
  assert.deepEqual(onlyLuna, [])
})
test("no key shaped like a provider secret exists anywhere in the repository", () => {
  const offenders = files.filter((p) => /sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{30,}/.test(read(p))).map(rel)
  assert.deepEqual(offenders, [])
})
test("the AI code makes no outbound network calls (no fetch, http(s), axios, sockets), except the single Luna provider file", () => {
  assert.deepEqual(R.networkProblems(aiFiles.map((p) => ({ rel: rel(p), text: read(p) }))), [])
  assert.match(read(path.join(AI, "luna", "constants.js")), /const ENDPOINT = "https:\/\/api\.openai\.com\/v1\/responses"/) // the endpoint lives in constants.js, not in provider.js
})
test("secret files stay git-ignored (general protection)", () => {
  assert.match(read(path.join(ROOT, ".gitignore")), /functions\/\.secret\.local/)
})

// ---------------------------------------------------------------- callables
test("every AI callable is exported with the plain wrapper (aiChat: the secret-bound wrapper) and authenticates in its handler", () => {
  const idx = read(path.join(ROOT, "functions", "index.js")), h = read(path.join(ROOT, "functions", "src", "handlers", "ai.js"))
  for (const f of ["aiChat", "aiSetLunaConsent", "aiGetUsage", "aiListConversations", "aiGetConversation", "aiDeleteConversation", "aiDeleteAllMyAiData", "aiAdminGetUsage", "aiAdminUpdateConfig"]) {
    assert.match(idx, new RegExp(f === "aiChat" ? "aiChat: withOpenAiKey\\(ai\\.aiChat\\)" : `${f}: wrap\\(ai\\.${f}\\)`), f)
    const start = h.indexOf(`async function ${f}(`), next = h.indexOf("\nasync function", start + 10)
    assert.match(h.slice(start, next > 0 ? next : undefined), /await verified\(request\)|requireActiveSuperAdmin\(request\)/, `${f} must authenticate`)
  }
  assert.doesNotMatch(idx + h, /wrapChat/)
  assert.doesNotMatch(h, /secrets:|defineSecret|process\.env/) // handlers never touch the secret
  assert.deepEqual(R.secretBindingProblems(idx), []) // original rule "no secrets: in index/handlers" is now: exactly one binding, on aiChat
  assert.match(idx, /const opts = \{ region: REGION,/); assert.doesNotMatch(idx, /region:\s*["'](?!africa-south1)/)
})

// ---------------------------------------------------------------- retrieval and engine are read-only and allow-listed
test("retrieval and engine code can only READ: no write API, and the only collection literals are organisations and homescreen", () => {
  const code = aiFiles.filter((p) => /\/(retrieval|engine)\//.test(p.split(path.sep).join("/")))
  assert.ok(code.length >= 10)
  for (const p of code) {
    const f = read(p)
    assert.doesNotMatch(f, /\.(runTransaction|batch)\(|\b(tx|batch|ref|doc|db|snap)\.(update|delete|create|set|add)\(|\bcollection\([^)]*\)(\.doc\([^)]*\))?\.(update|delete|create|set|add)\(/, rel(p))
    const setters = [...f.matchAll(/\b(\w+)\.set\(/g)].map((m) => m[1]); assert.ok(setters.every((r) => ["cache", "out", "single", "seen", "drop", "REGISTRY"].includes(r)), `${rel(p)}: ${setters.join()}`)
    const lits = [...f.matchAll(/collection\("([^"]+)"\)/g)].map((m) => m[1]); assert.ok(lits.every((l) => ["organisations"].includes(l)), `${rel(p)}: ${lits.join()}`)
  }
  for (const p of code.filter((x) => !/retrieval\/data\.js$/.test(x.split(path.sep).join("/")))) assert.doesNotMatch(read(p), /lib\/firebase/, `${rel(p)} must read through retrieval/data.js only`)
})
test("the engine cannot name a collection from user input: listing categories come from the fixed allow-list", () => {
  const { LISTING_COLLECTIONS } = require("../src/ai/constants")
  assert.deepEqual([...LISTING_COLLECTIONS].sort(), ["accommodations", "attractions", "business", "healthcare", "publicservice", "recreation", "restaurants"])
  assert.match(read(path.join(AI, "retrieval", "listings.js")), /LISTING_COLLECTIONS\.includes\(collection\)\) throw/)
  const forbidden = ["users", "bookings", "organisations", "organisation-members", "provider-applications", "super-admin", "reviews", "requests", "ai-conversations", "ai-usage", "ai-config", "audit-log", "editors"]
  for (const c of forbidden) assert.ok(!LISTING_COLLECTIONS.includes(c), c)
})
test("the data layer refuses any collection outside the public allow-list, whatever the caller passes", async () => {
  const { setup } = require("./helpers"); setup()
  const D = require("../src/ai/retrieval/data"), { PUBLIC_READ_COLLECTIONS } = require("../src/ai/constants")
  for (const c of ["users", "bookings", "organisations", "organisation-members", "provider-applications", "super-admin", "reviews", "requests", "ai-conversations", "ai-usage", "ai-config", "audit-log", "editors", "../users", "restaurants/r1/secret"]) {
    await assert.rejects(D.loadActive(c, { cache: { listingTtlSeconds: 0 } }, 10), /collection_not_allowed/, c); await assert.rejects(D.getVisible(c, "x"), /collection_not_allowed/, c)
  }
  assert.deepEqual([...PUBLIC_READ_COLLECTIONS].sort(), ["accommodations", "announcements", "attractions", "business", "emergency", "events", "healthcare", "homescreen", "loadshedding", "news", "publicservice", "recreation", "restaurants", "transport"])
})
test("ranking reads no paid-placement or ownership field", () => {
  const src = read(path.join(AI, "engine", "ranking.js")).replace(/^\s*\/\/.*$/gm, "")
  assert.doesNotMatch(src, /featured|promot|sponsor|paid|subscri|premium|\bplan\b|organisationId|ownerUid|boost|advert/i)
})
test("the English wording never says a place is available, that a booking is made, or gives a travel time", () => {
  const en = require("../src/ai/engine/locales/en.js"), { RE } = require("../src/ai/engine/safety")
  const strings = []
  const walkv = (v) => { if (typeof v === "string") strings.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walkv); else if (typeof v === "function") { try { strings.push(String(v("Place", "R10", "x", ["a"], 2, 3))) } catch (e) {} } }
  walkv(en)
  assert.ok(strings.length > 60)
  for (const s of strings) for (const [k, re] of Object.entries(RE)) assert.doesNotMatch(s, re, `${k}: ${s}`)
})

// ---------------------------------------------------------------- logs and rules
test("the log allow-list cannot carry message text, answers, records, emails or location", () => {
  const src = read(path.join(AI, "log.js"))
  const allowed = JSON.parse(src.match(/new Set\((\[.*?\])\)/)[1])
  for (const banned of ["message", "text", "content", "answer", "email", "location", "latitude", "longitude", "input", "result", "name", "uid", "displayName", "model", "inputTokens", "costMicros"]) assert.ok(!allowed.includes(banned), banned)
})
test("conversation, usage and config collections are explicitly closed to clients in the Firestore rules", () => {
  const rules = read(path.join(ROOT, "security-rules", "firestore.rules"))
  for (const c of ["ai-conversations", "ai-usage", "ai-config"]) {
    const m = rules.match(new RegExp(`match /${c}/\\{[A-Za-z]+\\}\\s*\\{([^}]*)`)); assert.ok(m, `${c} has an explicit match`)
    assert.match(m[1], /allow read, write: if false;/); assert.doesNotMatch(m[1], /request\.auth|if true/)
  }
  assert.match(rules, /match \/messages\/\{messageId\} \{ allow read, write: if false; \}/)
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/)
})
test("the composite index for the conversation list query exists", () => {
  const idx = JSON.parse(read(path.join(ROOT, "security-rules", "firestore.indexes.json")))
  assert.ok(idx.indexes.some((i) => i.collectionGroup === "ai-conversations" && i.fields.map((f) => `${f.fieldPath}:${f.order}`).join() === "ownerUid:ASCENDING,updatedAt:DESCENDING"))
})

test("ai-consent is closed to clients: the rules never open it, and everything undeclared is denied (no rules change was needed)", () => {
  const rules = read(path.join(ROOT, "security-rules", "firestore.rules"))
  assert.doesNotMatch(rules, /ai-consent/) // no client path exists: only the Admin SDK in aiSetLunaConsent / aiChat / aiGetUsage touches it
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/)
  const { PRIVATE_COLLECTIONS, PUBLIC_READ_COLLECTIONS } = require("../src/ai/constants")
  assert.ok(PRIVATE_COLLECTIONS.includes("ai-consent")); assert.ok(!PUBLIC_READ_COLLECTIONS.includes("ai-consent")) // and the assistant itself can never read it as content
})
