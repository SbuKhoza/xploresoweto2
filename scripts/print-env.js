#!/usr/bin/env node
"use strict"
// Prints the public EXPO_PUBLIC_* variables of one environment as JSON (used by the PowerShell scripts). Nothing secret.
const { varsFor } = require("./lib/envVars")
const name = process.argv[2]
if (!["production", "staging"].includes(name)) { console.error("Usage: node scripts/print-env.js <production|staging>"); process.exit(2) }
console.log(JSON.stringify(varsFor(name)))
