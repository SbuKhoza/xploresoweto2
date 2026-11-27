#!/usr/bin/env node
"use strict"
/**
 * PROPOSED repair of STAGING sample records (NOT executed as part of any delivery). Dry run by default.
 *   node scripts/repair-listings.js --project xploresoweto-staging                       dry run: prints the plan and its hash
 *   node scripts/repair-listings.js --project xploresoweto-staging --apply --approve-plan <hash>
 * Scope: only documents marked isSample:true or synthetic:true. Only ADDS what is absent/null: empty lists (what the CMS saves for an empty
 * field) and, for restaurants, a copy of the document's own `hours` text into `openingHours`. Existing values are never replaced, nothing is
 * invented, nothing is deleted. Apply needs the hash printed by the dry run (the approval is for exactly that plan) and re-reads each document
 * inside a transaction, so an edit made meanwhile is never overwritten. Production is refused. ADC only; no key files.
 */
const { resolveTarget, argValue, TargetError } = require("./lib/target")
const { buildPlan, applyPlan } = require("./lib/listing_audit")
const argv = process.argv.slice(2)
const die = (m) => { console.error(`\nERROR: ${m}\n`); process.exit(1) }
let target
try { target = resolveTarget({ project: argValue(argv, "project") }) } catch (e) { if (e instanceof TargetError) die(e.message); throw e }
if (target.production) die("This script never writes to production.")
if (target.envName !== "staging" && !target.emulator) die("Only the staging project or the local emulator can be repaired.")
const APPLY = argv.includes("--apply"), APPROVED = argValue(argv, "approve-plan")
if (APPLY && !APPROVED) die("--apply needs --approve-plan <hash> from a dry run you have reviewed.")
;(async () => {
  const admin = require("firebase-admin")
  admin.initializeApp({ projectId: target.projectId })
  const db = admin.firestore()
  console.log(`Target: ${target.emulator ? `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE staging project "${target.projectId}"`}   mode: ${APPLY ? "APPLY" : "DRY RUN (nothing is written)"}`)
  if (!APPLY) {
    const plan = await buildPlan(db)
    for (const r of plan.rows) console.log(`  ${r.path}: would add ${Object.keys(r.patch).join(", ")}`)
    console.log(`${plan.rows.length} document(s) in the plan. Plan hash: ${plan.hash}`)
    console.log(plan.rows.length ? "To apply after review: add --apply --approve-plan <that hash>." : "Nothing to repair.")
    return
  }
  const r = await applyPlan(db, { approvedHash: APPROVED })
  console.log(`Done. ${r.written} document(s) updated (${r.fields} field(s) added), ${r.skipped} skipped because they changed or no longer need it.`)
})().catch((e) => die(e.message))
