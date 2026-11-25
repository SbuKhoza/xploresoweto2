#!/usr/bin/env node
"use strict"
// Calls a deployed callable function as a signed-in user (e.g. a Super Admin running seedLoadshedding) using only fetch.
//   $env:ADMIN_EMAIL="..."; $env:ADMIN_PASSWORD="..."; node scripts/call.js --project xploresoweto-staging seedLoadshedding '{"schedules":[...]}'
// The project is REQUIRED (no default) and must be an exact allow-listed id. Production also needs --production and
// --confirm-project xploresoweto. Credentials come from the environment, never from files. The web API key is the project's PUBLIC one,
// taken from config/environments.js for the SAME project, so a key can never be paired with the wrong project.
const { resolveTarget, publicWebConfig, argValue, TargetError } = require("./lib/target")
;(async () => {
  const argv = process.argv.slice(2)
  const positional = []
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) { if (["--project", "--confirm-project"].includes(argv[i])) i++ } else positional.push(argv[i]) }
  const [name, json] = positional
  let target, cfg
  try {
    target = resolveTarget({ project: argValue(argv, "project"), production: argv.includes("--production"), confirmProject: argValue(argv, "confirm-project") })
    if (target.emulator) throw new TargetError("call.js talks to deployed functions only; the emulator is not supported here.")
    cfg = publicWebConfig(target.envName)
  } catch (e) { if (e instanceof TargetError) { console.error(`ERROR: ${e.message}`); process.exit(2) } throw e }
  if (!name || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) { console.error("Usage: $env:ADMIN_EMAIL=..; $env:ADMIN_PASSWORD=..; node scripts/call.js --project <id> [--production --confirm-project <id>] <function> '<json data>'"); process.exit(1) }
  console.log(`Target: ${target.production ? "PRODUCTION" : target.envName} project "${target.projectId}"`)
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, returnSecureToken: true }) }).then((r) => r.json())
  if (!login.idToken) { console.error("Sign-in failed:", login.error?.message); process.exit(1) }
  const res = await fetch(`https://${cfg.region}-${cfg.projectId}.cloudfunctions.net/${name}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.idToken}` }, body: JSON.stringify({ data: json ? JSON.parse(json) : {} }) })
  console.log(res.status, JSON.stringify(await res.json(), null, 2))
})().catch((e) => { console.error(e.message); process.exit(1) })
