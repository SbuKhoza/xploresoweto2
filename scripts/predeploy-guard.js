#!/usr/bin/env node
"use strict"
// Runs automatically before `firebase deploy --only functions` (firebase.json functions.predeploy), however the deploy was started,
// including by hand. The Firebase CLI provides GCLOUD_PROJECT (the target project). Rules and indexes deploys have NO such hook:
// use scripts/staging/deploy-staging.ps1 for those (see docs/staging/RUNBOOK.md, "Limitations").
const { execFileSync } = require("child_process")
const { evaluateDeploy } = require("./lib/deployGuard")
const git = (args) => { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() } catch (e) { return null } }
const project = process.env.GCLOUD_PROJECT || ""
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || ""
const dirty = (git(["status", "--porcelain"]) || "").length > 0
const r = evaluateDeploy({ project, branch: branch === "HEAD" ? "" : branch, dirty })
if (!r.ok) { console.error(`\nDeploy blocked by scripts/predeploy-guard.js:\n  - ${r.problems.join("\n  - ")}\n`); process.exit(1) }
console.log(`predeploy-guard: ${project} from "${branch || "?"}": allowed`)
