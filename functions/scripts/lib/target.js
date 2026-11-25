"use strict"
// Which Firebase project may an administrative script touch?  There is NO default: the caller must name the project, and the name must be
// one of the exact allow-listed ids. Production additionally needs --production AND the exact project id typed again (--confirm-project,
// or an interactive prompt where the script supports one). Nothing here reads, needs or prints a secret.
const path = require("path")
const { ENVIRONMENTS } = require(path.join(__dirname, "..", "..", "..", "config", "environments"))
const { projectIndicators, RETIRED_PROJECTS } = require("../../src/lib/environment")

const EMULATOR_PROJECT = "demo-xploresoweto" // only ever accepted together with a Firestore emulator host
class TargetError extends Error {}
const fail = (m) => { throw new TargetError(m) }

// opts: { project, production (boolean flag), confirmProject (string), typed (string, from an interactive prompt) }
function resolveTarget(opts = {}, env = process.env) {
  const project = typeof opts.project === "string" ? opts.project.trim() : ""
  if (!project) fail(`No project given. Pass --project ${ENVIRONMENTS.staging.projectId}. There is no default project.`)
  if (RETIRED_PROJECTS.includes(project)) fail(`Refusing to run against the retired project "${project}".`)
  const emulator = !!env.FIRESTORE_EMULATOR_HOST
  if (project === EMULATOR_PROJECT) {
    if (!emulator) fail(`"${EMULATOR_PROJECT}" is only accepted together with FIRESTORE_EMULATOR_HOST.`)
    return { projectId: project, envName: "emulator", production: false, emulator: true }
  }
  const match = Object.values(ENVIRONMENTS).find((e) => e.projectId === project) // EXACT id: never a prefix or suffix test
  if (!match) fail(`"${project}" is not an allowed project. Allowed: ${Object.values(ENVIRONMENTS).map((e) => e.projectId).join(", ")}.`)
  const ambient = projectIndicators(env).filter((p) => p !== project)
  if (ambient.length) fail(`The environment names a different project (${[...new Set(ambient)].join(", ")}) from --project ${project}. Unset GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT / GCP_PROJECT / FIREBASE_CONFIG and retry.`)
  const isProd = match.name === "production"
  if (!isProd && opts.production) fail(`--production was given but "${project}" is not the production project.`)
  if (isProd) {
    if (!opts.production) fail(`"${project}" is the PRODUCTION project. Production administration needs --production and the project id typed again.`)
    const typed = opts.confirmProject !== undefined ? opts.confirmProject : opts.typed
    if (typed !== project) fail(`Production confirmation missing or wrong. Re-run with --confirm-project ${project} (typed exactly).`)
  }
  return { projectId: project, envName: match.name, production: isProd, emulator: false }
}
const publicWebConfig = (envName) => {
  const e = ENVIRONMENTS[envName]
  if (!e) fail(`No web configuration for "${envName}".`)
  for (const k of ["apiKey", "authDomain", "projectId"]) if (!e.firebase[k]) fail(`The ${envName} Firebase web ${k} is not configured yet (config/environments.js). Create the project first, then commit the real public identifier.`)
  return { apiKey: e.firebase.apiKey, region: e.region, projectId: e.projectId }
}
const argValue = (argv, name) => { const i = argv.indexOf(`--${name}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined }
module.exports = { resolveTarget, publicWebConfig, argValue, TargetError, EMULATOR_PROJECT }
