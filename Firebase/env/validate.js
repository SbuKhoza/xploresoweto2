// PURE environment validation (no React Native, no Firebase imports, so it runs under `node --test` and in the EAS pre-install check).
// It decides whether the Firebase configuration this build was given is EXACTLY the one allowed for the environment this build claims to be,
// AND whether that environment matches the build's native identity (Android applicationId, or the web host). It runs BEFORE Firebase is
// initialised. Any doubt is a failure: there is no default environment and no fallback to production.
//
// Trust order: the native identity (set by the Gradle flavor, outside JavaScript) says what this build IS; the environment variables say
// what it was CONFIGURED as; config/environments.js says what is ALLOWED. All three must agree, field by field, by EXACT equality.
export const FIELDS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"]
const isStr = (v) => typeof v === "string" && v.length > 0 && v === v.trim()
const LOCAL_HOSTS = ["localhost", "127.0.0.1"]

// appEnv: "production" | "staging" (from EXPO_PUBLIC_APP_ENV)   values: the six firebase fields as supplied by the build
// identity: { kind: "android", applicationId } | { kind: "web", hostname } | anything else (unsupported => refused)
// environments: the table from config/environments.js
export function validateEnvironment({ appEnv, values, identity, environments }) {
  const problems = []
  const names = Object.keys(environments)
  if (!isStr(appEnv)) problems.push("EXPO_PUBLIC_APP_ENV is missing")
  else if (!names.includes(appEnv)) problems.push(`EXPO_PUBLIC_APP_ENV is not an allowed environment (allowed: ${names.join(", ")})`)
  const env = names.includes(appEnv) ? environments[appEnv] : null

  // 1. native identity decides what this build is
  if (!identity || typeof identity !== "object") problems.push("the build identity could not be read")
  else if (identity.kind === "android") {
    const implied = names.filter((n) => environments[n].androidApplicationId === identity.applicationId)
    if (implied.length !== 1) problems.push("the Android application id is not an allowed one")
    else if (env && implied[0] !== appEnv) problems.push(`this is the ${implied[0]} application but it was configured as ${appEnv}`)
  } else if (identity.kind === "web") {
    const host = typeof identity.hostname === "string" ? identity.hostname : ""
    if (!host) problems.push("the web host could not be read")
    else if (env && !env.webHosts.includes(host)) problems.push(`this web host is not allowed for ${appEnv}`)
    else if (!env && !names.some((n) => environments[n].webHosts.includes(host))) problems.push("this web host is not allowed")
  } else problems.push("this platform has no environment identity and is refused")

  // 2. every Firebase field: present, and EXACTLY the allow-listed value (a null allow-list entry means "not configured yet": refuse)
  if (env) {
    for (const f of FIELDS) {
      const want = env.firebase[f], got = values ? values[f] : undefined
      if (want === null || want === undefined) problems.push(`${f}: the ${appEnv} value is not configured yet (config/environments.js)`)
      else if (!isStr(got)) problems.push(`${f}: missing`)
      else if (got !== want) problems.push(`${f}: does not match the ${appEnv} environment`)
    }
    if (isStr(values && values.projectId) && values.authDomain !== `${values.projectId}.firebaseapp.com`) problems.push("authDomain: does not belong to the project")
    if (isStr(values && values.appId) && isStr(values && values.messagingSenderId) && !String(values.appId).startsWith(`1:${values.messagingSenderId}:web:`)) problems.push("appId: does not belong to the sender id")
  }
  if (problems.length) return { ok: false, problems, env: null, config: null }
  return { ok: true, problems: [], env, config: Object.fromEntries(FIELDS.map((f) => [f, values[f]])) }
}
export const isLocalHost = (h) => LOCAL_HOSTS.includes(h)
