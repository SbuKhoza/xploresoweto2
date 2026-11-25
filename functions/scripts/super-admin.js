#!/usr/bin/env node
"use strict"
/**
 * Super-admin bootstrap helper (trusted, run by a human; read-only for the `super-admin` collection).
 *
 *   node scripts/super-admin.js status
 *   node scripts/super-admin.js bootstrap --uid <FIREBASE_AUTH_UID> [--confirm-email <email>] [--allow-multiple]
 *   node scripts/super-admin.js sync      --uid <FIREBASE_AUTH_UID>     (align the claim with the record; clears it if inactive)
 *
 * Authentication: Application Default Credentials only (`gcloud auth application-default login`). Key files inside this
 * repository are refused, and the old project is hard-refused. Nothing is hardcoded.
 */
const path = require("path")
const readline = require("readline")
const admin = require("firebase-admin")
const lib = require("../src/lib/bootstrap")

const args = process.argv.slice(2)
const VALUE_FLAGS = ["--project", "--uid", "--confirm-email", "--confirm-project"]
const command = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1]))
const flag = (n) => { const i = args.indexOf(`--${n}`); return i > -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined }
const has = (n) => args.includes(`--${n}`)
const die = (m) => { console.error(`\nERROR: ${m}\n`); process.exit(1) }

// The project is REQUIRED (no default) and must be an exact allow-listed id. Production also needs --production and the id typed again.
const { resolveTarget, TargetError } = require("./lib/target")
let target
try {
  target = resolveTarget({ project: flag("project"), production: has("production"), confirmProject: flag("confirm-project") })
} catch (e) { if (e instanceof TargetError) die(e.message); throw e }
const projectId = target.projectId
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (key && path.resolve(key).startsWith(path.resolve(__dirname, "..", "..") + path.sep)) die("GOOGLE_APPLICATION_CREDENTIALS points inside this repository. Keep service-account keys outside the repo (or use ADC).")
admin.initializeApp({ projectId })
console.log(`Target: ${process.env.FIRESTORE_EMULATOR_HOST ? `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE ${target.production ? "PRODUCTION " : ""}project "${projectId}"`}`)

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()) }) })

;(async () => {
  if (command === "status") {
    const rows = await lib.status()
    if (!rows.length) return console.log("No super-admin records exist yet. Create the first one manually in the console.")
    rows.forEach((r) => console.log(`${r.uid}  ${r.email}  active=${r.active}  claim=${r.claim}${r.problems.length ? "\n    ! " + r.problems.join("\n    ! ") : ""}`))
  } else if (command === "bootstrap") {
    const typed = flag("confirm-email")
    const r = await lib.bootstrap({
      uid: flag("uid"), allowMultiple: has("allow-multiple"),
      confirm: async (user) => {
        console.log(`\nAccount: ${user.email}  |  ${user.displayName || "-"}  |  created ${user.metadata.creationTime}  |  emailVerified=${user.emailVerified}`)
        const answer = typed ?? (await ask(`Type the email "${user.email}" to ACTIVATE super-admin claim: `))
        return answer.toLowerCase() === String(user.email).toLowerCase()
      },
    })
    console.log("\nResult:", r)
    if (!r.emailVerified) console.log("\nNOTE: this email is NOT verified. The account's admin powers stay inert until it verifies its email (functions and rules require it).")
    console.log("The user must sign out and sign in again (or refresh the ID token) to receive the claim.")
  } else if (command === "sync") {
    if (!flag("uid")) die("--uid is required")
    console.log(await lib.syncOne(flag("uid")))
  } else die("Usage: super-admin.js <status|bootstrap|sync> [--uid UID]")
})().catch((e) => die(e.bootstrap ? e.message : e.stack || e.message))
