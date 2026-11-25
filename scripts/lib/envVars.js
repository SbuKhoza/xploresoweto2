"use strict"
// The EXPO_PUBLIC_* variables for an environment, derived from config/environments.js (the single source of truth).
// A null (not yet known) identifier is OMITTED, so a build for that environment is missing it and fails closed.
const path = require("path")
const { ENVIRONMENTS } = require(path.join(__dirname, "..", "..", "config", "environments"))
const MAP = { apiKey: "EXPO_PUBLIC_FIREBASE_API_KEY", authDomain: "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", projectId: "EXPO_PUBLIC_FIREBASE_PROJECT_ID", storageBucket: "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET", messagingSenderId: "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", appId: "EXPO_PUBLIC_FIREBASE_APP_ID" }
function varsFor(name) {
  const e = ENVIRONMENTS[name]
  if (!e) throw new Error(`Unknown environment "${name}"`)
  const out = { EXPO_PUBLIC_APP_ENV: name }
  for (const [field, key] of Object.entries(MAP)) if (e.firebase[field] !== null) out[key] = e.firebase[field]
  return out
}
// EAS build profile -> environment and the Gradle flavor its gradleCommand must name. Unknown profiles are refused.
const PROFILES = Object.freeze({
  development: { env: "production", flavor: "Production" }, preview: { env: "production", flavor: "Production" },
  production: { env: "production", flavor: "Production" }, local: { env: "production", flavor: "Production" },
  staging: { env: "staging", flavor: "Staging" }, "staging-dev": { env: "staging", flavor: "Staging" },
})
// Checks one eas.json profile against the table. Returns a list of problems (empty = fine).
function checkProfile(easJson, profile) {
  const p = []
  const rule = PROFILES[profile]
  if (!rule) return [`EAS profile "${profile}" has no environment rule`]
  const def = (easJson.build || {})[profile]
  if (!def) return [`EAS profile "${profile}" is not defined in eas.json`]
  const want = varsFor(rule.env), env = def.env || {}
  for (const [k, v] of Object.entries(want)) if (env[k] !== v) p.push(`${profile}: ${k} must be "${v}"`)
  for (const k of Object.keys(env)) if (k.startsWith("EXPO_PUBLIC_") && !(k in want)) p.push(`${profile}: ${k} is set but not part of the ${rule.env} environment`)
  const gc = def.android && def.android.gradleCommand
  if (typeof gc !== "string" || !new RegExp(`:app:(assemble|bundle)${rule.flavor}(Debug|Release)$`).test(gc)) p.push(`${profile}: android.gradleCommand must build the ${rule.flavor} flavor (got ${JSON.stringify(gc)})`)
  const other = rule.flavor === "Staging" ? "Production" : "Staging"
  if (typeof gc === "string" && gc.includes(other)) p.push(`${profile}: gradleCommand names the wrong flavor`)
  return p
}
module.exports = { varsFor, checkProfile, PROFILES }
