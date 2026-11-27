#!/usr/bin/env node
"use strict"
/**
 * READ-ONLY audit of listing documents in the STAGING Firestore (or the local emulator). It never writes: the only Firestore call is `.get()`.
 *   node scripts/audit-listings.js --project xploresoweto-staging [--out audit.json]
 * The report lists document paths, field names and finding codes only: never document contents, names, contacts or image URLs.
 * Production is refused. Authentication: Application Default Credentials only; no key files, no secrets.
 */
const fs = require("fs")
const { resolveTarget, argValue, TargetError } = require("./lib/target")
const { runAudit } = require("./lib/listing_audit")
const argv = process.argv.slice(2)
const die = (m) => { console.error(`\nERROR: ${m}\n`); process.exit(1) }
let target
try { target = resolveTarget({ project: argValue(argv, "project") }) } catch (e) { if (e instanceof TargetError) die(e.message); throw e }
if (target.production) die("This script never runs against production.")
if (target.envName !== "staging" && !target.emulator) die("Only the staging project or the local emulator can be audited.")
;(async () => {
  const admin = require("firebase-admin")
  admin.initializeApp({ projectId: target.projectId })
  const report = await runAudit(admin.firestore())
  const out = { project: target.projectId, readOnly: true, generatedAt: new Date().toISOString(), counts: report.counts, documents: report.documents.filter((d) => d.findings.length) }
  console.log(`Audited ${report.counts.documents} documents in "${target.projectId}" (read-only): ${report.counts.withFindings} with findings, ${report.counts.repairable} repairable, ${report.counts.needReview} need manual review.`)
  for (const d of out.documents) console.log(`  ${d.path}${d.marked ? "" : " (not sample-marked)"}: ${d.findings.map((f) => `${f.field}:${f.code}${f.repairable ? "*" : ""}`).join(", ")}`)
  console.log("  (* = repairable by scripts/repair-listings.js, which is dry-run by default)")
  const o = argValue(argv, "out"); if (o) { fs.writeFileSync(o, JSON.stringify(out, null, 2)); console.log(`Report written to ${o}`) }
})().catch((e) => die(e.message))
