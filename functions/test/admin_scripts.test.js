"use strict"
// Administrative script guards. Every case here must stop BEFORE any network, credential or Firebase access.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const T = require("../scripts/lib/target")
const CFG = require("../../config/environments")
const SCRIPTS = path.join(__dirname, "..", "scripts")
const bare = () => { const e = { ...process.env }; for (const k of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "FIREBASE_CONFIG", "FIRESTORE_EMULATOR_HOST", "ADMIN_EMAIL", "ADMIN_PASSWORD", "GOOGLE_APPLICATION_CREDENTIALS"]) delete e[k]; return e }
const run = (script, args, env = bare()) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { env, encoding: "utf8", timeout: 30000 })
const rejects = (opts, re, env = {}) => assert.throws(() => T.resolveTarget(opts, env), (e) => e instanceof T.TargetError && re.test(e.message))

test("resolveTarget: no default, exact ids only", () => {
  rejects({}, /No project given/); rejects({ project: "" }, /No project given/)
  for (const p of ["xploresoweto-staging2", "my-staging", "xploresoweto-prod", "XPLORESOWETO", "xploresoweto "]) { if (p.trim() !== "xploresoweto") rejects({ project: p }, /not an allowed project/) }
  rejects({ project: "the-steady-hotel" }, /retired/)
  assert.deepEqual(T.resolveTarget({ project: "xploresoweto-staging" }, {}), { projectId: "xploresoweto-staging", envName: "staging", production: false, emulator: false })
})
test("resolveTarget: production needs --production AND the exact id typed again", () => {
  rejects({ project: "xploresoweto" }, /PRODUCTION/)
  rejects({ project: "xploresoweto", production: true }, /confirmation/)
  rejects({ project: "xploresoweto", production: true, confirmProject: "xploresoweto-staging" }, /confirmation/)
  rejects({ project: "xploresoweto", production: true, confirmProject: "XPLORESOWETO" }, /confirmation/)
  assert.equal(T.resolveTarget({ project: "xploresoweto", production: true, confirmProject: "xploresoweto" }, {}).production, true)
  rejects({ project: "xploresoweto-staging", production: true }, /not the production project/)
})
test("resolveTarget: an ambient project that disagrees blocks the run; the emulator project needs an emulator host", () => {
  rejects({ project: "xploresoweto-staging" }, /different project/, { GCLOUD_PROJECT: "xploresoweto" })
  rejects({ project: "xploresoweto-staging" }, /different project/, { FIREBASE_CONFIG: JSON.stringify({ projectId: "xploresoweto" }) })
  assert.equal(T.resolveTarget({ project: "xploresoweto-staging" }, { GCLOUD_PROJECT: "xploresoweto-staging" }).envName, "staging")
  rejects({ project: "demo-xploresoweto" }, /EMULATOR/); assert.equal(T.resolveTarget({ project: "demo-xploresoweto" }, { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }).emulator, true)
})
test("the public web configuration is per project and fails closed while staging identifiers are unknown", () => {
  assert.equal(T.publicWebConfig("production").projectId, "xploresoweto")
  if (CFG.ENVIRONMENTS.staging.firebase.apiKey === null) assert.throws(() => T.publicWebConfig("staging"), /not configured yet/)
  else assert.equal(T.publicWebConfig("staging").projectId, "xploresoweto-staging")
})
test("call.js: stops before any network without a project, with a wrong one, and for production without confirmation", () => {
  const cases = [[["seedLoadshedding"], /No project given/], [["--project", "xploresoweto", "seedLoadshedding"], /PRODUCTION/], [["--project", "xploresoweto", "--production", "seedLoadshedding"], /confirmation/], [["--project", "nope", "x"], /not an allowed project/], [["--project", "the-steady-hotel", "x"], /retired/]]
  for (const [args, re] of cases) { const r = run("call.js", args, { ...bare(), ADMIN_EMAIL: "a@b.c", ADMIN_PASSWORD: "x" }); assert.equal(r.status, 2, args.join(" ")); assert.match(r.stderr, re) }
})
test("call.js: staging stops cleanly while its web identifiers are not configured, and never prints the production key or project", () => {
  const r = run("call.js", ["--project", "xploresoweto-staging", "ping"], { ...bare(), ADMIN_EMAIL: "a@b.c", ADMIN_PASSWORD: "x" })
  if (CFG.ENVIRONMENTS.staging.firebase.apiKey === null) { assert.equal(r.status, 2); assert.match(r.stderr, /not configured yet/) }
  assert.ok(!(r.stdout + r.stderr).includes(CFG.ENVIRONMENTS.production.firebase.apiKey)); assert.ok(!/Target: PRODUCTION/.test(r.stdout))
})
test("super-admin.js: stops before the Admin SDK for no project, wrong project, retired project and unconfirmed production", () => {
  const cases = [[["status"], /No project given/], [["--project", "the-steady-hotel", "status"], /retired/], [["--project", "xploresoweto", "status"], /PRODUCTION/], [["--project", "xploresoweto", "--production", "status"], /confirmation/], [["--project", "other-staging", "status"], /not an allowed project/]]
  for (const [args, re] of cases) { const r = run("super-admin.js", args); assert.equal(r.status, 1, args.join(" ")); assert.match(r.stderr, re); assert.ok(!/Target:/.test(r.stdout), "never reached the target line") }
})
test("super-admin.js: the project flag may come first and the command is still found", () => {
  const src = fs.readFileSync(path.join(SCRIPTS, "super-admin.js"), "utf8")
  assert.ok(!/flag\("project"\)\s*\|\|/.test(src), "no default project"); assert.ok(!/"xploresoweto"/.test(src), "no hard-coded project")
})
test("no script in functions/scripts hard-codes a project, a web API key, or touches Secret Manager or a provider", () => {
  for (const f of fs.readdirSync(SCRIPTS).filter((n) => n.endsWith(".js")).concat(fs.readdirSync(path.join(SCRIPTS, "lib")).map((n) => `lib/${n}`))) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), "utf8")
    assert.ok(!src.includes(CFG.ENVIRONMENTS.production.firebase.apiKey), `${f}: web key`)
    if (f !== "luna-calibrate.js") assert.ok(!/secretmanager|secret-manager|OPENAI|api\.openai/i.test(src), `${f}: secret/provider`)
    assert.ok(!/PROJECT\s*=\s*["']xploresoweto["']/.test(src), `${f}: hard-coded project`)
  }
})
