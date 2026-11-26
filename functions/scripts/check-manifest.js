#!/usr/bin/env node
"use strict"
// OFFLINE pre-deploy check for staging: generates the function manifest locally (no network, no Firebase access) and asserts what a staging
// deploy will create: all functions present, none binds or declares a secret, every function capped at 3 instances, region africa-south1.
//   node functions/scripts/check-manifest.js
const fs = require("fs"), os = require("os"), path = require("path")
const { spawnSync } = require("child_process")
const { STAGING_PROJECT } = require("../src/lib/environment")
const BIN = path.join(__dirname, "..", "node_modules", "firebase-functions", "lib", "bin", "firebase-functions.js")
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xs-manifest-")), "m.json")
const env = { ...process.env, GCLOUD_PROJECT: STAGING_PROJECT, FUNCTIONS_MANIFEST_OUTPUT_PATH: out }
for (const k of Object.keys(env)) if (["GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "FIREBASE_CONFIG"].includes(k) || /(_API_KEY|_SECRET)$/.test(k)) delete env[k]
const r = spawnSync(process.execPath, [BIN, path.join(__dirname, "..")], { env, encoding: "utf8", timeout: 90000 })
const fail = (m) => { console.error(`check-manifest FAILED: ${m}`); process.exit(1) }
if (r.status !== 0) fail(r.stderr || "discovery failed (is `npm ci` done in functions/?)")
const m = JSON.parse(fs.readFileSync(out, "utf8")), names = Object.keys(m.endpoints), problems = []
if (names.length !== 41) problems.push(`expected 41 functions (30 original + 11 learning/erasure), found ${names.length}`)
for (const n of names) {
  const e = m.endpoints[n]
  if ((e.secretEnvironmentVariables || []).length) problems.push(`${n} binds a secret`)
  if (e.maxInstances !== 3) problems.push(`${n} maxInstances=${e.maxInstances} (want 3)`)
  if (!Array.isArray(e.region) || e.region[0] !== "africa-south1") problems.push(`${n} region`)
}
if ((m.params || []).some((p) => p.type === "secret")) problems.push("a secret parameter is declared")
if (problems.length) fail(problems.join("; "))
console.log(`check-manifest: OK for ${STAGING_PROJECT}: ${names.length} functions, no secrets, maxInstances 3, africa-south1`)
