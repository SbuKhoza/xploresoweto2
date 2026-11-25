"use strict"
// Which Firebase project is this code running (or being analysed for deployment) in?
// The two project ids are repeated here ON PURPOSE: the functions folder is deployed by itself and cannot import ../config.
// functions/test/environment.test.js fails if these ever differ from config/environments.js.
//
// Staging is recognised by EXACT project id (never by a name suffix). If ANY of the standard project indicators names the staging
// project, the code behaves as staging, so contradictory indicators cannot switch the protections off.
const PRODUCTION_PROJECT = "xploresoweto"
const STAGING_PROJECT = "xploresoweto-staging"
const RETIRED_PROJECTS = Object.freeze(["the-steady-hotel"])

function projectIndicators(env = process.env) {
  const out = []
  for (const k of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT"]) if (typeof env[k] === "string" && env[k]) out.push(env[k])
  try { const c = JSON.parse(env.FIREBASE_CONFIG || "null"); if (c && typeof c.projectId === "string" && c.projectId) out.push(c.projectId) } catch (e) { /* not JSON: ignore */ }
  return out
}
const isStaging = (env = process.env) => projectIndicators(env).includes(STAGING_PROJECT)
const isProduction = (env = process.env) => { const p = projectIndicators(env); return p.length > 0 && p.every((x) => x === PRODUCTION_PROJECT) }

// Hard cap on instances per function. Production keeps its existing value of 10.
const maxInstances = (env = process.env) => (isStaging(env) ? 3 : 10)
// The assistant's optional wording layer must never contact a provider from staging, whatever configuration or key exists.
const lunaBlocked = (env = process.env) => isStaging(env)
// The provider secret is bound to the one function that needs it everywhere EXCEPT staging. Anything not exactly staging keeps the binding.
const bindProviderSecret = (env = process.env) => !isStaging(env)

module.exports = { PRODUCTION_PROJECT, STAGING_PROJECT, RETIRED_PROJECTS, projectIndicators, isStaging, isProduction, maxInstances, lunaBlocked, bindProviderSecret }
