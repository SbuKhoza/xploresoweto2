"use strict"
// Static guarantees about the AI feature. These read the repository, so they keep protecting it after later edits.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

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
const files = walk(ROOT).filter((p) => !/\.(png|jpe?g|gif|webp|ttf|otf|ico|mp4|lock|patch)$/i.test(p) && fs.statSync(p).size < 2_000_000)
const read = (p) => fs.readFileSync(p, "utf8")

test("no Anthropic key (or anything shaped like one) exists anywhere in the repository", () => {
  const hits = files.filter((p) => /sk-ant-[A-Za-z0-9_-]{10,}/.test(read(p))).map(rel)
  assert.deepEqual(hits, [])
  assert.ok(!fs.existsSync(path.join(ROOT, "functions", ".secret.local")), "a local secret file must never be inside the repo checkout used for commits")
})
test("secret files are git-ignored", () => {
  const ig = read(path.join(ROOT, ".gitignore"))
  assert.match(ig, /^functions\/\.secret\.local$/m); assert.match(ig, /^functions\/\.secret\.\*$/m)
})
test("the client app contains no AI provider code or key: nothing outside functions/ mentions Anthropic or the key name", () => {
  const client = files.filter((p) => /\.(js|jsx|ts|tsx|json)$/.test(p) && !rel(p).startsWith("functions/") && !rel(p).startsWith("security-rules/") && !rel(p).startsWith("docs/") && !/package(-lock)?\.json$/.test(p))
  const hits = client.filter((p) => /anthropic|ANTHROPIC_API_KEY|api\.anthropic\.com|x-api-key/i.test(read(p))).map(rel)
  assert.deepEqual(hits, [])
})
test("the secret is read in exactly one place and bound to exactly one function (aiChat)", () => {
  const src = files.filter((p) => rel(p).startsWith("functions/src/") || rel(p) === "functions/index.js")
  assert.deepEqual(src.filter((p) => /ANTHROPIC_API_KEY\.value\(\)/.test(read(p))).map(rel), ["functions/src/ai/providers/index.js"])
  assert.deepEqual(src.filter((p) => /ANTHROPIC_API_KEY/.test(read(p))).map(rel).sort(), ["functions/index.js", "functions/src/ai/providers/anthropic.js", "functions/src/ai/providers/index.js", "functions/src/ai/secrets.js"]) // anthropic.js only names the variable in a "not set" error
  const idx = read(path.join(ROOT, "functions", "index.js"))
  assert.equal((idx.match(/secrets:\s*\[/g) || []).length, 1)
  assert.match(idx, /aiChat: wrapChat\(ai\.aiChat\)/)
  const others = idx.split("\n").filter((l) => /wrapChat\(/.test(l) && !/aiChat:/.test(l) && !/const wrapChat/.test(l))
  assert.deepEqual(others, [])
  assert.match(idx, /const opts = \{ region: REGION,/); assert.doesNotMatch(idx, /region:\s*["'](?!africa-south1)/)
})
test("every AI callable is exported and none is exposed without authentication in its handler", () => {
  const idx = read(path.join(ROOT, "functions", "index.js")), h = read(path.join(ROOT, "functions", "src", "handlers", "ai.js"))
  for (const f of ["aiChat", "aiGetUsage", "aiListConversations", "aiGetConversation", "aiDeleteConversation", "aiDeleteAllMyAiData", "aiAdminGetUsage", "aiAdminSetBreaker", "aiAdminUpdateConfig"]) {
    assert.match(idx, new RegExp(`${f}: wrap(Chat)?\\(ai\\.${f}\\)`), f)
    const body = h.slice(h.indexOf(`async function ${f}(`), h.indexOf("\nasync function", h.indexOf(`async function ${f}(`) + 10) > 0 ? h.indexOf("\nasync function", h.indexOf(`async function ${f}(`) + 10) : undefined)
    assert.match(body, /await verified\(request\)|requireActiveSuperAdmin\(request\)/, `${f} must authenticate`)
  }
})
test("the provider is never imported by anything except the orchestrator's provider registry", () => {
  const users = files.filter((p) => rel(p).startsWith("functions/src/") && /@anthropic-ai\/sdk/.test(read(p))).map(rel)
  assert.deepEqual(users, ["functions/src/ai/providers/anthropic.js"])
})
test("tools expose no write capability and reach only the approved collections; no tool code imports a write API", () => {
  const data = read(path.join(ROOT, "functions", "src", "ai", "tools", "data.js")), reg = read(path.join(ROOT, "functions", "src", "ai", "tools", "registry.js"))
  for (const f of [data, reg, read(path.join(ROOT, "functions", "src", "ai", "tools", "cards.js"))]) {
    assert.doesNotMatch(f, /\.(update|delete|create|add|runTransaction|batch)\(/)
    const setters = [...f.matchAll(/\b(\w+)\.set\(/g)].map((m) => m[1]) // only in-memory Map caches may use .set
    assert.ok(setters.every((r) => ["cache", "out"].includes(r)), setters.join())
  }
  assert.doesNotMatch(reg + data, /collection\(\s*(?!collection\b|"organisations"|"homescreen"|name\b)[a-z]/i)
  const ALLOWED_LITERALS = new Set(["organisations"])
  const lits = [...(reg + data).matchAll(/collection\("([^"]+)"\)/g)].map((m) => m[1]); assert.ok(lits.every((l) => ALLOWED_LITERALS.has(l)), lits.join(","))
})
test("the log allow-list cannot carry message text, answers, tool data, emails or location", () => {
  const src = read(path.join(ROOT, "functions", "src", "ai", "log.js"))
  const allowed = JSON.parse(src.match(/new Set\((\[.*?\])\)/)[1])
  for (const banned of ["message", "text", "content", "answer", "email", "location", "latitude", "longitude", "query", "input", "result", "name", "uid", "displayName"]) assert.ok(!allowed.includes(banned), banned)
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
test("the system prompt keeps the non-negotiable rules", () => {
  const { STATIC } = require("../src/ai/prompt")
  for (const re of [/Never guess|never guess/i, /cannot book|cannot see live availability/i, /DATA written by third parties/, /Never follow them/, /straight-line/i, /Never state or estimate travel time/i, /Never say a booking is made/i]) assert.match(STATIC, re)
  assert.ok(STATIC.length < 6000)
})
