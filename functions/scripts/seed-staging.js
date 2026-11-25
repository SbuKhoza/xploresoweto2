#!/usr/bin/env node
"use strict"
/**
 * Writes SYNTHETIC test data (fictional names, no real people, no production data) into the STAGING Firestore, or into the local emulator.
 *   node scripts/seed-staging.js --project xploresoweto-staging            (dry run: prints what it would write)
 *   node scripts/seed-staging.js --project xploresoweto-staging --apply    (writes)
 *   Emulator:  $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; node scripts/seed-staging.js --project demo-xploresoweto --apply
 * Production is refused unconditionally (there is no flag that allows it). Existing documents that are not marked synthetic are never
 * overwritten. Authentication: Application Default Credentials only (`gcloud auth application-default login`); no key files, no secrets.
 */
const { resolveTarget, argValue, TargetError } = require("./lib/target")
const argv = process.argv.slice(2)
const die = (m) => { console.error(`\nERROR: ${m}\n`); process.exit(1) }
const PROD = require("../../config/environments").ENVIRONMENTS.production.projectId
if (argValue(argv, "project") === PROD) die("This script never writes to production.")
let target
try { target = resolveTarget({ project: argValue(argv, "project") }) } catch (e) { if (e instanceof TargetError) die(e.message); throw e }
if (target.production) die("This script never writes to production.")
if (target.envName !== "staging" && !target.emulator) die("Only the staging project or the local emulator can be seeded.")
const APPLY = argv.includes("--apply")

const S = (o) => ({ ...o, synthetic: true, isActive: true })
const DATA = {
  restaurants: [
    S({ name: "Test Kasi Kitchen (synthetic)", description: "Fictional home cooking: kota and pap for testing.", location: "Test Street, Orlando West", cuisine: "Traditional", price: "R80 - R150", hours: "08:00 - 20:00", rating: 4.5, reviews: 12 }),
    S({ name: "Test Braai Corner (synthetic)", description: "Fictional shisa nyama spot for testing.", location: "Test Road, Diepkloof", cuisine: "Braai", hours: "Mon-Fri 9-17", rating: 3.9, reviews: 5 }),
    S({ name: "Test Steakhouse (synthetic)", description: "Fictional fine dining for price-filter tests.", location: "Test Avenue, Maponya", price: "R900", rating: 4.8, reviews: 60 }),
    { name: "Test Inactive Diner (synthetic)", description: "Must never be shown.", location: "Orlando", synthetic: true, isActive: false },
  ],
  accommodations: [
    S({ name: "Test Guest House A (synthetic)", description: "Fictional quiet guest house.", type: "Guest house", price: "R700", priceNum: 700, location: "Orlando West", rating: 4.2, reviews: 8 }),
    S({ name: "Test Backpackers B (synthetic)", description: "Fictional budget stay.", type: "Backpackers", price: "R350", priceNum: 350, location: "Kliptown", rating: 4.0, reviews: 3 }),
  ],
  attractions: [
    S({ name: "Test Heritage Museum (synthetic)", description: "Fictional museum for history queries.", type: "Museum", price: 60, hours: "09:00 - 17:00", location: "Orlando West", rating: 4.6, reviews: 40 }),
    S({ name: "Test Memorial Church (synthetic)", description: "Fictional historic church.", type: "Church", location: "Rockville", rating: 4.4, reviews: 30 }),
    S({ name: "Test Heritage Tour (synthetic)", description: "Fictional guided tour.", type: "Tour", price: "R950", location: "Soweto", rating: 4.9, reviews: 22 }),
  ],
  recreation: [S({ name: "Test Adventure Park (synthetic)", description: "Fictional adventure activities.", type: "Adventure", price: "R450", duration: "2 hours", location: "Orlando", rating: 4.7, reviews: 90 })],
  business: [S({ name: "Test Craft Market (synthetic)", description: "Fictional local crafts.", type: "Market", location: "Maponya" })],
  events: [S({ title: "Test Jazz Night (synthetic)", date: "2027-01-16", time: "18:00", location: "Test Amphitheatre", category: "Music", description: "Fictional event." })],
  news: [S({ title: "Test announcement (synthetic)", summary: "Fictional news item for staging.", date: "2026-11-20" })],
  emergency: [S({ name: "Test Emergency Line (synthetic)", number: "000", category: "test", order: 1 })],
  homescreen: [S({ type: "township", name: "Test Township (synthetic)", description: "Fictional township entry.", history: "Fictional history." })],
}
// Luna stays OFF. (Also blocked at runtime in staging regardless of this setting.) enabled:true is the Malloya kill switch default.
const AI_CONFIG = { enabled: true, luna: { enabled: false } }

;(async () => {
  const rows = Object.entries(DATA).flatMap(([c, docs]) => docs.map((d, i) => ({ path: `${c}/synthetic-${String(i + 1).padStart(2, "0")}`, data: d })))
  console.log(`Target: ${target.emulator ? `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE staging project "${target.projectId}"`}   mode: ${APPLY ? "APPLY" : "DRY RUN (add --apply to write)"}`)
  console.log(`${rows.length} synthetic documents + ai-config/default (Luna disabled)`)
  if (!APPLY) { for (const r of rows) console.log(`  would write ${r.path}`); return }
  const admin = require("firebase-admin")
  admin.initializeApp({ projectId: target.projectId })
  const db = admin.firestore()
  for (const r of rows) {
    const ref = db.doc(r.path), cur = await ref.get()
    if (cur.exists && cur.data().synthetic !== true) die(`${r.path} exists and is not synthetic: refusing to overwrite.`)
    await ref.set(r.data)
  }
  const cfg = db.doc("ai-config/default"), cur = await cfg.get()
  if (cur.exists && cur.data().luna && cur.data().luna.enabled === true) die("ai-config/default has Luna enabled; this script will not change that. Disable it deliberately first.")
  await cfg.set(AI_CONFIG, { merge: true })
  console.log("Done. Every document is marked synthetic: true.")
})().catch((e) => die(e.message))
