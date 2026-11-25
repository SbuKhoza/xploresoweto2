import { ENVIRONMENTS } from "../../config/environments"
import { validateEnvironment } from "./validate"
import { readPublicEnv } from "./publicEnv"
import { getIdentity } from "./identity"

let cached = null
// Evaluated once per launch, before Firebase is initialised.
export function evaluateEnvironment() {
  if (!cached) {
    const { appEnv, values } = readPublicEnv()
    cached = validateEnvironment({ appEnv, values, identity: getIdentity(), environments: ENVIRONMENTS })
  }
  return cached
}
// Used by Firebase/config.*: returns the validated config, or throws so that initializeApp is never reached with a wrong one.
export function requireValidEnvironment() {
  const r = evaluateEnvironment()
  if (!r.ok) { const e = new Error(`Environment check failed: ${r.problems.join("; ")}`); e.name = "EnvironmentError"; e.problems = r.problems; throw e }
  return r
}
