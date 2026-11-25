#!/usr/bin/env node
"use strict"
// EAS "eas-build-pre-install" hook: stops the build BEFORE anything is compiled if the profile, the environment variables and the
// Gradle flavor do not agree. Also usable by hand:  node scripts/verify-env.js <profile>
const fs = require("fs"), path = require("path")
const { varsFor, checkProfile, PROFILES } = require("./lib/envVars")
const profile = process.argv[2] || process.env.EAS_BUILD_PROFILE
const fail = (m) => { console.error(`\nEnvironment check FAILED: ${m}\n`); process.exit(1) }
if (!profile) { console.log("verify-env: no EAS profile (not an EAS build); nothing to check."); process.exit(0) }
if (!PROFILES[profile]) fail(`EAS profile "${profile}" has no environment rule.`)
const easJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "eas.json"), "utf8"))
const problems = checkProfile(easJson, profile)
const want = varsFor(PROFILES[profile].env)
if (process.env.EAS_BUILD_PROFILE) for (const [k, v] of Object.entries(want)) if (process.env[k] !== v) problems.push(`the build environment variable ${k} does not match the ${PROFILES[profile].env} environment`)
if (PROFILES[profile].env === "staging") for (const k of ["EXPO_PUBLIC_FIREBASE_API_KEY", "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "EXPO_PUBLIC_FIREBASE_APP_ID"]) if (!(k in want)) problems.push(`${k}: the staging value is not configured yet (config/environments.js); create the staging project first`)
if (problems.length) fail(problems.join("\n  - "))
console.log(`verify-env: profile "${profile}" -> ${PROFILES[profile].env}: OK`)
