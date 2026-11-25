"use strict"
// Decides whether a deployment may proceed. PURE: inputs in, verdict out. The branch name is a SECOND check, never the only one:
// the project id is always checked by exact equality, and the deploy scripts always pass --project explicitly (they do not trust
// .firebaserc aliases, `firebase use` state, or GCLOUD_PROJECT left over in a shell).
const path = require("path")
const { ENVIRONMENTS } = require(path.join(__dirname, "..", "..", "config", "environments"))
const STAGING = ENVIRONMENTS.staging.projectId, PRODUCTION = ENVIRONMENTS.production.projectId
const isStagingBranch = (b) => typeof b === "string" && (b === "staging" || b.startsWith("staging/"))

// project: the project the deploy will touch; branch: current git branch ("" if detached/unknown); dirty: uncommitted changes exist
function evaluateDeploy({ project, branch, dirty }) {
  const problems = []
  if (project !== STAGING && project !== PRODUCTION) problems.push(`"${project || ""}" is not an allowed deploy target (allowed: ${STAGING}, ${PRODUCTION})`)
  if (project === STAGING) {
    if (!isStagingBranch(branch)) problems.push(`staging may only be deployed from a staging/* branch (current: ${branch || "detached or unknown"})`)
    if (dirty) problems.push("the working tree has uncommitted changes; commit them so the deployed code is reviewable")
  }
  if (project === PRODUCTION && isStagingBranch(branch)) problems.push(`PRODUCTION must never be deployed from a staging branch (current: ${branch})`)
  return { ok: problems.length === 0, problems }
}
module.exports = { evaluateDeploy, isStagingBranch, STAGING, PRODUCTION }
