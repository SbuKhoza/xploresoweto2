"use strict"
// Staging foundation, group B: the app's environment guard. Pure logic runs under node --test (React Native screens cannot).
// The guard must fail CLOSED: missing, mismatched, swapped or unconfigured values all stop the app before Firebase initialises.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const root = path.join(__dirname, "..", "..")
const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
const load = (f) => import(pathToFileURL(path.join(root, f)).href)
const CFG = require("../../config/environments")
const { varsFor } = require("../../scripts/lib/envVars")

// A synthetic, clearly fake "created" staging project, to exercise the staging path before the real project exists.
const FAKE_STAGING = { ...CFG.ENVIRONMENTS.staging, firebase: { ...CFG.ENVIRONMENTS.staging.firebase, apiKey: "AIzaSyFAKE-FOR-UNIT-TESTS-ONLY-0000000", messagingSenderId: "111111111111", appId: "1:111111111111:web:aaaaaaaaaaaaaaaaaaaaaa" } }
const TABLE = { production: CFG.ENVIRONMENTS.production, staging: FAKE_STAGING }
const PROD_ID = { kind: "android", applicationId: "com.sbudamalloya.xploresoweto" }, STG_ID = { kind: "android", applicationId: "com.sbudamalloya.xploresoweto.staging" }
const good = (name, table = TABLE) => ({ appEnv: name, values: { ...table[name].firebase }, identity: name === "production" ? PROD_ID : STG_ID, environments: table })

test("production: the exact baseline configuration of c419086 is accepted unchanged (production regression)", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  const r = validateEnvironment(good("production"))
  assert.equal(r.ok, true, r.problems.join("; "))
  assert.deepEqual(r.config, { apiKey: "AIzaSyCwRLeFV0lxbez-G3YONR-WIcdgF3xSUpg", authDomain: "xploresoweto.firebaseapp.com", projectId: "xploresoweto", storageBucket: "xploresoweto.firebasestorage.app", messagingSenderId: "549315620435", appId: "1:549315620435:web:49b7fa6887d89a94c560a6" })
  assert.deepEqual(varsFor("production"), { EXPO_PUBLIC_APP_ENV: "production", EXPO_PUBLIC_FIREBASE_API_KEY: r.config.apiKey, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: r.config.authDomain, EXPO_PUBLIC_FIREBASE_PROJECT_ID: "xploresoweto", EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: r.config.storageBucket, EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: r.config.messagingSenderId, EXPO_PUBLIC_FIREBASE_APP_ID: r.config.appId })
})
test("staging: accepted only when every field is the allow-listed one and the build is the staging application", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  assert.equal(validateEnvironment(good("staging")).ok, true)
})
test("the REAL staging table is not configured yet: staging fails closed until the console identifiers are committed", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  const real = { production: CFG.ENVIRONMENTS.production, staging: CFG.ENVIRONMENTS.staging }
  const r = validateEnvironment({ appEnv: "staging", values: { ...CFG.ENVIRONMENTS.staging.firebase }, identity: STG_ID, environments: real })
  if (CFG.ENVIRONMENTS.staging.firebase.apiKey === null) { assert.equal(r.ok, false); assert.ok(r.problems.some((p) => /apiKey.*not configured yet/.test(p)) && r.problems.some((p) => /appId.*not configured yet/.test(p))) }
  assert.equal(CFG.ENVIRONMENTS.staging.firebase.projectId, "xploresoweto-staging")
})
test("a missing or empty environment name, or an unknown one, fails", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  for (const appEnv of [undefined, "", " staging", "Staging", "prod", "development", "xploresoweto-staging", null]) { const r = validateEnvironment({ ...good("staging"), appEnv }); assert.equal(r.ok, false, String(appEnv)); assert.equal(r.config, null) }
})
test("every Firebase field is required for each environment: missing, empty, padded or altered values fail", async () => {
  const { validateEnvironment, FIELDS } = await load("Firebase/env/validate.js")
  for (const name of ["production", "staging"]) for (const f of FIELDS) {
    for (const bad of [undefined, "", " ", `${TABLE[name].firebase[f]} `, `${TABLE[name].firebase[f]}x`, "other"]) {
      const g = good(name); g.values[f] = bad; const r = validateEnvironment(g)
      assert.equal(r.ok, false, `${name}.${f}=${JSON.stringify(bad)}`); assert.ok(r.problems.some((p) => p.startsWith(f)), `${name}.${f} named in problems`)
    }
  }
})
test("SWAPPED environments fail in every direction: production values in a staging app, staging values in a production app, mixed fields", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  assert.equal(validateEnvironment({ ...good("staging"), values: { ...TABLE.production.firebase } }).ok, false) // staging app, production values
  assert.equal(validateEnvironment({ ...good("production"), values: { ...TABLE.staging.firebase } }).ok, false)
  assert.equal(validateEnvironment({ ...good("staging"), appEnv: "production" }).ok, false) // staging app claiming to be production
  assert.equal(validateEnvironment({ ...good("production"), appEnv: "staging" }).ok, false) // production app claiming to be staging
  const mixed = good("staging"); mixed.values.projectId = "xploresoweto"; assert.equal(validateEnvironment(mixed).ok, false)
  const mixed2 = good("staging"); mixed2.values.apiKey = TABLE.production.firebase.apiKey; assert.equal(validateEnvironment(mixed2).ok, false)
  const mixed3 = good("staging"); mixed3.values.storageBucket = TABLE.production.firebase.storageBucket; assert.equal(validateEnvironment(mixed3).ok, false)
  const mixed4 = good("staging"); mixed4.values.appId = TABLE.production.firebase.appId; assert.equal(validateEnvironment(mixed4).ok, false)
})
test("the native application id must be EXACTLY an allow-listed one (no suffix or prefix tricks), and must match the claimed environment", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  for (const applicationId of ["com.sbudamalloya.xploresoweto.stagingx", "com.sbudamalloya.xploresoweto.staging.evil", "com.sbudamalloya.xploresoweto.debug", "com.sbudamalloya.xploresoweto2", "host.exp.exponent", "", undefined, "COM.SBUDAMALLOYA.XPLORESOWETO"]) {
    assert.equal(validateEnvironment({ ...good("staging"), identity: { kind: "android", applicationId } }).ok, false, String(applicationId))
    assert.equal(validateEnvironment({ ...good("production"), identity: { kind: "android", applicationId } }).ok, false, String(applicationId))
  }
  for (const identity of [{ kind: "unsupported" }, { kind: "unreadable" }, { kind: "ios" }, null, undefined, "android"]) { assert.equal(validateEnvironment({ ...good("staging"), identity }).ok, false); assert.equal(validateEnvironment({ ...good("production"), identity }).ok, false) }
})
test("authDomain must belong to the project and appId to the sender id", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  const t = { production: TABLE.production, staging: { ...TABLE.staging, firebase: { ...TABLE.staging.firebase, authDomain: "xploresoweto.firebaseapp.com" } } }
  assert.equal(validateEnvironment({ ...good("staging", t), environments: t }).ok, false)
  const t2 = { production: TABLE.production, staging: { ...TABLE.staging, firebase: { ...TABLE.staging.firebase, appId: "1:222222222222:web:bbbb" } } }
  assert.equal(validateEnvironment({ ...good("staging", t2), environments: t2 }).ok, false)
})
test("web builds get the same protection: the host must be allowed for the claimed environment, and all fields must match", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  const web = (name, hostname) => ({ appEnv: name, values: { ...TABLE[name].firebase }, identity: { kind: "web", hostname }, environments: TABLE })
  assert.equal(validateEnvironment(web("staging", "xploresoweto-staging.web.app")).ok, true)
  assert.equal(validateEnvironment(web("staging", "localhost")).ok, true) // development
  assert.equal(validateEnvironment(web("production", "xploresoweto.web.app")).ok, true)
  assert.equal(validateEnvironment(web("staging", "xploresoweto.web.app")).ok, false) // staging config served from a production host
  assert.equal(validateEnvironment(web("production", "xploresoweto-staging.web.app")).ok, false)
  for (const h of ["", "evil.example.com", "xploresoweto-staging.web.app.evil.com", "sub.localhost"]) { assert.equal(validateEnvironment(web("staging", h)).ok, false, h); assert.equal(validateEnvironment(web("production", h)).ok, false, h) }
  assert.equal(validateEnvironment({ ...web("staging", "localhost"), values: { ...TABLE.production.firebase } }).ok, false) // right host, wrong values
})
test("problems never echo a configured value (no key, id or domain is printed)", async () => {
  const { validateEnvironment } = await load("Firebase/env/validate.js")
  const g = good("staging"); g.values.apiKey = "AIzaSyLEAK-CANARY-0000000000000000"; g.values.appId = "1:999:web:canary"
  const txt = JSON.stringify(validateEnvironment(g).problems); assert.ok(!txt.includes("CANARY") && !txt.includes("canary"))
})
test("token audience: only the configured project's tokens are accepted (supplementary check)", async () => {
  const { checkTokenAudience: c } = await load("Firebase/env/tokenAudience.js")
  assert.equal(c({ aud: "xploresoweto-staging", iss: "https://securetoken.google.com/xploresoweto-staging" }, "xploresoweto-staging").ok, true)
  assert.equal(c({ aud: "xploresoweto", iss: "https://securetoken.google.com/xploresoweto" }, "xploresoweto-staging").ok, false)
  assert.equal(c({ aud: "xploresoweto-staging", iss: "https://securetoken.google.com/xploresoweto" }, "xploresoweto-staging").ok, false)
  for (const bad of [null, undefined, {}, "x"]) assert.equal(c(bad, "xploresoweto-staging").ok, false)
  assert.equal(c({ aud: "a", iss: "https://securetoken.google.com/a" }, "").ok, false)
})

// ---------------------------------------------------------------- source structure (what the screens cannot test at runtime)
test("no Firebase identifier is hard-coded in the app config, and nothing defaults to production", () => {
  for (const f of ["Firebase/config.native.js", "Firebase/config.web.js"]) {
    const s = read(f)
    assert.ok(!/AIza/.test(s) && !/xploresoweto/.test(s.replace(/\/\/[^\n]*/g, "")) && !/1:\d+:web:/.test(s), `${f}: literal identifier`)
    assert.ok(s.indexOf("requireValidEnvironment()") > -1 && s.indexOf("requireValidEnvironment()") < s.indexOf("initializeApp(firebaseConfig)"), `${f}: validated before initializeApp`)
    assert.ok(!/\|\|\s*["']/.test(s) && !/\?\?\s*["']/.test(s), `${f}: no string fallback`)
  }
  for (const f of ["Firebase/env/validate.js", "Firebase/env/gate.js", "Firebase/env/publicEnv.js"]) assert.ok(!/\|\|\s*["'](production|staging)/.test(read(f)), `${f}: no default environment`)
})
test("EXPO_PUBLIC variables are referenced explicitly and only in publicEnv.js", () => {
  const s = read("Firebase/env/publicEnv.js")
  for (const k of ["APP_ENV", "FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_STORAGE_BUCKET", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID"]) assert.ok(s.includes(`process.env.EXPO_PUBLIC_${k}`), k)
  assert.ok(!/process\.env\s*\[|\{[^}]*\}\s*=\s*process\.env/.test(s), "no dynamic or destructured env access")
  for (const f of ["Firebase/config.native.js", "Firebase/config.web.js", "Firebase/env/gate.js", "App.js", "index.js"]) assert.ok(!/process\.env\.EXPO_PUBLIC_/.test(read(f)), `${f}`)
})
test("startup order: the gate runs before the app is loaded; a failure shows an error screen and loads no app code", () => {
  const s = read("index.js")
  assert.ok(s.indexOf("evaluateEnvironment()") > -1 && s.indexOf("evaluateEnvironment()") < s.indexOf("require('./App')"))
  assert.ok(!/^import\s+App\b/m.test(s), "App is not imported statically")
  assert.ok(/gate\.ok/.test(s) && /EnvironmentError/.test(s))
})
test("platform identity: native reads the application id from the native layer; web reads the host; there is no cross-platform default", () => {
  assert.match(read("Firebase/env/identity.native.js"), /getBundleId\(\)/); assert.match(read("Firebase/env/identity.native.js"), /Platform\.OS !== "android"/)
  assert.match(read("Firebase/env/identity.web.js"), /window\.location\.hostname/)
})
test("staging is visibly marked inside the app", () => {
  assert.match(read("App.js"), /<EnvironmentBanner \/>/)
  const b = read("components/EnvironmentBanner.js"); assert.match(b, /APP_ENV === "production"\) return null/); assert.match(b, /toUpperCase\(\)/)
})
test("the session audience check is wired into the auth listener and signs out only on a definite mismatch", () => {
  const s = read("utils/persistAuth.js")
  assert.match(s, /checkTokenAudience\(result\.claims, auth\.app\.options\.projectId\)/); assert.match(s, /signOut\(auth\)/)
  assert.match(s, /catch \(error\) \{\s*return true/)
})
