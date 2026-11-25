#!/usr/bin/env node
"use strict"
// Runs a command with the public Firebase variables of ONE environment (no files, no defaults):
//   node scripts/with-env.js staging expo start        node scripts/with-env.js production expo run:android --variant productionDebug
// Variables already present in the shell for the same names are overwritten, so a stale value cannot leak in.
const { spawn } = require("child_process")
const { varsFor } = require("./lib/envVars")
const [name, ...cmd] = process.argv.slice(2)
if (!["production", "staging"].includes(name) || !cmd.length) { console.error("Usage: node scripts/with-env.js <production|staging> <command...>"); process.exit(2) }
const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...varsFor(name) } })
child.on("exit", (code) => process.exit(code === null ? 1 : code))
