#!/usr/bin/env node
"use strict"
// Rewrites the `env` block of every eas.json build profile from config/environments.js (the single source of truth), keeping everything
// else in eas.json untouched. Run it after committing the real staging identifiers:  node scripts/sync-eas-env.js
//   node scripts/sync-eas-env.js --check    (exit 1 if eas.json is out of date; changes nothing)
const fs = require("fs"), path = require("path")
const { varsFor, PROFILES } = require("./lib/envVars")
const file = path.join(__dirname, "..", "eas.json")
const j = JSON.parse(fs.readFileSync(file, "utf8"))
let changed = false
for (const [name, rule] of Object.entries(PROFILES)) {
  if (!j.build[name]) { console.error(`eas.json has no profile "${name}"`); process.exit(1) }
  const want = varsFor(rule.env)
  if (JSON.stringify(j.build[name].env) !== JSON.stringify(want)) { j.build[name].env = want; changed = true; console.log(`updated ${name}`) }
}
if (process.argv.includes("--check")) { if (changed) { console.error("eas.json is out of date: run node scripts/sync-eas-env.js"); process.exit(1) } console.log("eas.json env blocks are current."); process.exit(0) }
if (changed) fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n"); else console.log("eas.json already current.")
