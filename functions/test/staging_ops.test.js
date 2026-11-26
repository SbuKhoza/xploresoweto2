"use strict"
// Staging foundation, group D: deployment guards, PowerShell tooling and synthetic seeding. PowerShell itself cannot run in this test (no
// PowerShell on the CI host), so the scripts are checked STATICALLY and every decision they rely on is made in Node, where it is tested.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const root = path.join(__dirname, "..", "..")
const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
const G = require("../../scripts/lib/deployGuard")
const noComments = (t) => t.replace(/<#[\s\S]*?#>/g, "").replace(/^\s*#.*$/gm, "")
const PS = fs.readdirSync(path.join(root, "scripts", "staging")).filter((f) => f.endsWith(".ps1"))
const clean = (over = {}) => { const e = { ...process.env }; for (const k of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "FIREBASE_CONFIG", "FIRESTORE_EMULATOR_HOST"]) delete e[k]; return { ...e, ...over } }

test("deploy guard: staging only from a staging/* branch with a clean tree; production never from a staging branch; unknown projects never", () => {
  const ok = (a) => G.evaluateDeploy(a).ok
  assert.equal(ok({ project: "xploresoweto-staging", branch: "staging/env-foundation", dirty: false }), true)
  assert.equal(ok({ project: "xploresoweto-staging", branch: "staging/base", dirty: false }), true)
  assert.equal(ok({ project: "xploresoweto-staging", branch: "staging", dirty: false }), true)
  assert.equal(ok({ project: "xploresoweto-staging", branch: "main", dirty: false }), false)
  assert.equal(ok({ project: "xploresoweto-staging", branch: "stage2b/expo-ai-integration", dirty: false }), false)
  assert.equal(ok({ project: "xploresoweto-staging", branch: "stagingx", dirty: false }), false)
  assert.equal(ok({ project: "xploresoweto-staging", branch: "", dirty: false }), false) // detached / unknown
  assert.equal(ok({ project: "xploresoweto-staging", branch: "staging/x", dirty: true }), false)
  assert.equal(ok({ project: "xploresoweto", branch: "staging/env-foundation", dirty: false }), false) // THE accident this prevents
  assert.equal(ok({ project: "xploresoweto", branch: "staging", dirty: false }), false)
  assert.equal(ok({ project: "xploresoweto", branch: "stage2b/expo-ai-integration", dirty: true }), true) // production flow is not newly obstructed
  for (const project of ["", undefined, "xploresoweto-staging2", "other-staging", "the-steady-hotel"]) assert.equal(ok({ project, branch: "staging/x", dirty: false }), false, String(project))
})
test("predeploy guard script fails closed without a project or with an unknown one", () => {
  for (const env of [clean(), clean({ GCLOUD_PROJECT: "other-staging" }), clean({ GCLOUD_PROJECT: "xploresoweto-staging2" })]) {
    const r = spawnSync(process.execPath, [path.join(root, "scripts", "predeploy-guard.js")], { env, encoding: "utf8", cwd: root })
    assert.equal(r.status, 1); assert.match(r.stderr, /not an allowed deploy target/)
  }
})
test("firebase.json runs the predeploy guard for functions and keeps the rules and indexes paths unchanged", () => {
  const j = JSON.parse(read("firebase.json"))
  assert.deepEqual(j.functions[0].predeploy, ['node "$PROJECT_DIR/scripts/predeploy-guard.js"'])
  assert.equal(j.functions[0].source, "functions"); assert.equal(j.functions[0].codebase, "default")
  assert.deepEqual(j.firestore, { rules: "security-rules/firestore.rules", indexes: "security-rules/firestore.indexes.json" }); assert.deepEqual(j.storage, { rules: "security-rules/storage.rules" })
})
test(".firebaserc holds aliases only and NO default (and no script relies on it)", () => {
  const j = JSON.parse(read(".firebaserc")); assert.deepEqual(j, { projects: { staging: "xploresoweto-staging", production: "xploresoweto" } }); assert.ok(!("default" in j.projects))
  for (const f of PS) assert.ok(!/firebase use|\.firebaserc|--alias/.test(noComments(read(`scripts/staging/${f}`))), f)
})
test("PowerShell tooling only: no Bash scripts, ASCII-only (Windows PowerShell 5.1 safe), every script is strict and stops on error", () => {
  const all = fs.readdirSync(path.join(root, "scripts", "staging")); assert.deepEqual(all.filter((f) => /\.(sh|bash)$/.test(f)), [])
  for (const f of ["deploy-staging", "verify-staging", "seed-staging", "create-testers", "build-android-staging", "check-apk", "new-staging-project", "create-local-staging-keystore"]) assert.ok(PS.includes(`${f}.ps1`), f)
  for (const f of PS) {
    const t = read(`scripts/staging/${f}`)
    assert.ok(/^[\x00-\x7F]*$/.test(t), `${f}: non-ASCII character`); assert.ok(!/^#!/.test(t), `${f}: shebang`); assert.ok(!/&&|\|\|\s*exit|\bexport\s+\w+=/.test(t.replace(/^\s*#.*$/gm, "")), `${f}: bash/PS7-only syntax`)
    assert.match(t, /Set-StrictMode -Version Latest/); assert.match(t, /\$ErrorActionPreference = 'Stop'/); assert.match(t, /#Requires -Version 5\.1/)
  }
})
test("deploy-staging.ps1: exact literal project, explicit --project, guard before deploy, confirmation, never --force", () => {
  const t = read("scripts/staging/deploy-staging.ps1"), code = noComments(t)
  assert.match(t, /\$Project = 'xploresoweto-staging'/); assert.ok(!/param\([^)]*\$Project/s.test(t), "project is not a parameter")
  assert.ok(!/\bxploresoweto\b(?!-staging)/.test(code.replace(/'xploresoweto-staging'/g, "")), "production id absent from executable code")
  assert.match(t, /'--project', \$Project/)
  assert.ok(t.indexOf("scripts/staging/guard.js deploy $Project") > -1 && t.indexOf("guard.js") < t.indexOf("& firebase @fbArgs"), "guard runs first")
  assert.ok(t.indexOf("check-manifest.js") < t.indexOf("& firebase @fbArgs")); assert.ok(t.indexOf("Read-Host") < t.indexOf("& firebase @fbArgs"))
  assert.match(t, /\$typed -cne \$Project/); assert.match(t, /\$env:GCLOUD_PROJECT = \$Project/)
  for (const v of ["GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "FIREBASE_CONFIG", "_API_KEY"]) assert.ok(t.includes(v), v)
  for (const f of PS) { const c = noComments(read(`scripts/staging/${f}`)); assert.ok(!/--force/.test(c), `${f}: --force`); assert.ok(!/functions:secrets|secrets:set|secrets:access|gcloud secrets (versions|create|add)/.test(c), `${f}: touches secrets`) }
  assert.deepEqual([...t.matchAll(/'(deploy)', '--only', \$only, '--project', \$Project/g)].length, 1)
})
test("every PowerShell script that talks to Firebase or Google Cloud names the staging project literally and never the production one", () => {
  for (const f of PS) {
    const code = read(`scripts/staging/${f}`).replace(/^\s*#.*$/gm, "").replace(/<#[\s\S]*?#>/g, "")
    if (!/firebase|gcloud|node scripts/.test(code) || f === "check-apk.ps1" || f === "create-local-staging-keystore.ps1" || f === "build-android-staging.ps1") continue
    assert.match(code, /\$Project = 'xploresoweto-staging'/, f); assert.ok(!/xploresoweto(?!-staging|\.staging)/.test(code.replace(/\$Project = 'xploresoweto-staging'/g, "").replace(/com\.sbudamalloya\.xploresoweto(\.staging)?/g, "")), `${f}: production id`)
  }
})
test("new-staging-project.ps1 is a PLAN by default, needs the id typed to execute, and treats the budget as an alert", () => {
  const t = read("scripts/staging/new-staging-project.ps1")
  assert.match(t, /if \(-not \$Execute\) \{[^}]*exit 0/); assert.ok(t.indexOf("Read-Host") < t.indexOf("Invoke-Expression"))
  for (const s of ["gcloud projects create $Project", "firebase projects:addfirebase $Project", "--location=$Region", "com.sbudamalloya.xploresoweto.staging"]) assert.ok(t.includes(s), s)
  assert.match(t, /\$Region = 'africa-south1'/); assert.match(t, /ALERT threshold, not a spending cap/)
})
test("the staging build script refuses debug signing, repository keystores and an unconfigured environment", () => {
  const t = read("scripts/staging/build-android-staging.ps1")
  for (const s of ["verify-env.js staging", "XS_STAGING_STORE_FILE", "debug.keystore", "OUTSIDE the repository", "never signed with the debug key", ":app:assembleStaging$Variant"]) assert.ok(t.includes(s), s)
  assert.ok(!/assembleProduction|assembleRelease\b|bundle/.test(t.replace(/^\s*#.*$/gm, "")), "builds the staging flavor only")
})
test("seed and tester scripts: staging or emulator only, dry run by default, production refused with or without flags", () => {
  const run = (script, args, env) => spawnSync(process.execPath, [path.join(root, "functions", "scripts", script), ...args], { env: env || clean(), encoding: "utf8" })
  let r = run("seed-staging.js", ["--project", "xploresoweto-staging"]); assert.equal(r.status, 0); assert.match(r.stdout, /DRY RUN/); assert.match(r.stdout, /15 synthetic documents/); assert.ok(!/Done\./.test(r.stdout))
  for (const args of [["--project", "xploresoweto"], ["--project", "xploresoweto", "--production", "--confirm-project", "xploresoweto"], ["--project", "other-staging"], []]) { r = run("seed-staging.js", args); assert.notEqual(r.status, 0, args.join(" ")); assert.ok(!/DRY RUN/.test(r.stdout)) }
  r = run("seed-staging.js", ["--project", "xploresoweto", "--production", "--confirm-project", "xploresoweto"]); assert.match(r.stderr, /never writes to production/)
  const src = read("functions/scripts/seed-staging.js")
  assert.match(src, /synthetic: true/); assert.match(src, /luna: \{ enabled: false \}/); assert.match(src, /refusing to overwrite/); assert.ok(!/AIza|password|secret/i.test(src.replace(/Application Default Credentials only[^\n]*/, "").replace(/no secrets/g, "")))
  r = run("create-testers.js", ["--project", "xploresoweto", "--file", "x.json"]); assert.notEqual(r.status, 0)
})
test("seed data is entirely synthetic, public-collection shaped, and contains no private-looking values", () => {
  const src = read("functions/scripts/seed-staging.js")
  const names = [...src.matchAll(/(?:name|title): "([^"]+)"/g)].map((m) => m[1]); assert.ok(names.length >= 14)
  for (const n of names) assert.match(n, /\(synthetic\)/, n)
  assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}|\b0[6-8]\d{8}\b|\+27/i.test(src), "no emails or phone numbers")
  for (const c of ["restaurants", "accommodations", "attractions", "recreation", "business", "events", "news", "emergency", "homescreen"]) assert.ok(new RegExp(`\\b${c}: \\[`).test(src), c)
})
test("the offline manifest check passes for staging", () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "check-manifest.js")], { env: clean(), encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /41 functions, no secrets, maxInstances 3/)
})
test("gitignore keeps tester lists and keystores out of the repository", () => {
  const g = read(".gitignore"); for (const p of ["*.jks", "serviceAccount*.json"]) assert.ok(g.includes(p), p)
  assert.ok(/testers\*?\.json|\*\.local\.json|testers/.test(g), "tester files ignored")
})
