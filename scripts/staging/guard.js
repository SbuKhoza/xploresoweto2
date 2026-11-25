#!/usr/bin/env node
"use strict"
// Called by the PowerShell deploy script BEFORE anything is deployed:  node scripts/staging/guard.js deploy xploresoweto-staging
// Exit 0 = allowed. Nothing here touches the network or reads a secret.
const { execFileSync } = require("child_process")
const { evaluateDeploy } = require("../lib/deployGuard")
const [cmd, project] = process.argv.slice(2)
if (cmd !== "deploy" || !project) { console.error("Usage: node scripts/staging/guard.js deploy <project>"); process.exit(2) }
const git = (args) => { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() } catch (e) { return null } }
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "", dirty = (git(["status", "--porcelain"]) || "").length > 0
const r = evaluateDeploy({ project, branch: branch === "HEAD" ? "" : branch, dirty })
if (!r.ok) { console.error(`BLOCKED:\n  - ${r.problems.join("\n  - ")}`); process.exit(1) }
console.log(`guard: ${project} from branch "${branch}" (clean): allowed. HEAD ${git(["rev-parse", "--short", "HEAD"])}`)
