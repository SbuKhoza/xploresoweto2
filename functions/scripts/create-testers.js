#!/usr/bin/env node
"use strict"
/**
 * Creates the STAGING test accounts (at most 5), each with a verified email, a random password nobody ever sees, and a one-time
 * password-setup link printed to YOUR terminal for you to pass on.
 *   node scripts/create-testers.js --project xploresoweto-staging --file C:\private\testers.json            (dry run)
 *   node scripts/create-testers.js --project xploresoweto-staging --file C:\private\testers.json --apply
 * testers.json: [{ "email": "...", "displayName": "Tester One" }]  (keep it OUTSIDE this repository; the script refuses a file inside it)
 * Staging only (or the Auth emulator). Production is refused unconditionally. ADC only; no secrets are read or written.
 */
const fs = require("fs"), path = require("path"), crypto = require("crypto")
const { resolveTarget, argValue, TargetError } = require("./lib/target")
const argv = process.argv.slice(2)
const die = (m) => { console.error(`\nERROR: ${m}\n`); process.exit(1) }
const PROD = require("../../config/environments").ENVIRONMENTS.production.projectId
if (argValue(argv, "project") === PROD) die("This script never touches production.")
let target
try { target = resolveTarget({ project: argValue(argv, "project") }) } catch (e) { if (e instanceof TargetError) die(e.message); throw e }
if (target.production) die("This script never touches production.")
if (target.envName !== "staging" && !target.emulator) die("Only staging or the local emulator.")
const file = argValue(argv, "file")
if (!file) die("--file <testers.json> is required.")
const abs = path.resolve(file), repo = path.resolve(__dirname, "..", "..") + path.sep
if (abs.startsWith(repo)) die("The testers file must live OUTSIDE this repository.")
let testers
try { testers = JSON.parse(fs.readFileSync(abs, "utf8")) } catch (e) { die(`Cannot read the testers file: ${e.message}`) }
if (!Array.isArray(testers) || testers.length < 1 || testers.length > 5) die("The file must hold 1 to 5 testers.")
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const seen = new Set()
for (const t of testers) { if (!t || !EMAIL.test(t.email || "")) die(`Invalid email: ${t && t.email}`); const k = t.email.toLowerCase(); if (seen.has(k)) die(`Duplicate: ${t.email}`); seen.add(k) }
const APPLY = argv.includes("--apply")
;(async () => {
  console.log(`Target: ${target.emulator ? "EMULATOR" : `LIVE staging project "${target.projectId}"`}  mode: ${APPLY ? "APPLY" : "DRY RUN"}  testers: ${testers.length}`)
  if (!APPLY) { testers.forEach((t) => console.log(`  would create ${t.email}`)); return }
  const admin = require("firebase-admin"); admin.initializeApp({ projectId: target.projectId })
  for (const t of testers) {
    let user
    try { user = await admin.auth().createUser({ email: t.email, emailVerified: true, displayName: t.displayName || undefined, password: crypto.randomBytes(24).toString("base64url") }) }
    catch (e) { if (e.code === "auth/email-already-exists") { console.log(`  exists: ${t.email}`); user = await admin.auth().getUserByEmail(t.email) } else throw e }
    const link = await admin.auth().generatePasswordResetLink(t.email)
    console.log(`  ${t.email}  uid=${user.uid}\n    password-setup link (one time, pass on privately): ${link}`)
  }
})().catch((e) => die(e.message))
