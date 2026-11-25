"use strict"
// Staging foundation, group C: Android flavors, signing and EAS profiles, checked STATICALLY (Gradle and EAS are not run in CI here).
// These tests prove the configuration says what it must; they are NOT a substitute for building the variants (see docs/staging/ANDROID_AND_EAS.md).
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const root = path.join(__dirname, "..", "..")
const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
const CFG = require("../../config/environments")
const { varsFor, checkProfile, PROFILES } = require("../../scripts/lib/envVars")
const eas = JSON.parse(read("eas.json")), gradle = read("android/app/build.gradle")
const block = (src, name) => { // the {...} body that follows `name {` (balanced)
  const i = src.indexOf(`${name} {`); assert.ok(i > -1, `${name} block`)
  let d = 0, j = src.indexOf("{", i)
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}" && --d === 0) return src.slice(j + 1, k) }
  assert.fail(`${name} unbalanced`)
}

test("every EAS profile maps to exactly one environment and the matching Gradle flavor (existing four profiles verified, two staging added)", () => {
  assert.deepEqual(Object.keys(eas.build).sort(), Object.keys(PROFILES).sort())
  for (const p of Object.keys(eas.build)) assert.deepEqual(checkProfile(eas, p), [], p)
  for (const p of ["development", "preview", "production", "local"]) { assert.deepEqual(eas.build[p].env, varsFor("production"), p); assert.match(eas.build[p].android.gradleCommand, /:app:(assemble|bundle)Production(Debug|Release)$/, p) }
  for (const p of ["staging", "staging-dev"]) { assert.equal(eas.build[p].env.EXPO_PUBLIC_APP_ENV, "staging"); assert.match(eas.build[p].android.gradleCommand, /:app:assembleStaging(Debug|Release)$/, p) }
})
test("existing profile behaviour is preserved: artifact kinds, distribution, autoIncrement, remote versioning, submit", () => {
  assert.equal(eas.cli.appVersionSource, "remote"); assert.equal(eas.cli.version, ">= 16.1.0"); assert.deepEqual(eas.submit, { production: {} })
  assert.equal(eas.build.development.developmentClient, true); assert.equal(eas.build.development.distribution, "internal"); assert.match(eas.build.development.android.gradleCommand, /Debug$/)
  assert.equal(eas.build.preview.distribution, "internal"); assert.equal(eas.build.preview.android.buildType, "apk"); assert.match(eas.build.preview.android.gradleCommand, /^:app:assembleProductionRelease$/)
  assert.equal(eas.build.production.autoIncrement, true); assert.match(eas.build.production.android.gradleCommand, /^:app:bundleProductionRelease$/) // still an app bundle
  assert.equal(eas.build.local.android.buildType, "apk")
})
test("a staging profile can carry no production identifier and a production profile no staging one", () => {
  const prod = Object.values(varsFor("production")).filter((v) => v !== "production")
  for (const p of ["staging", "staging-dev"]) for (const v of Object.values(eas.build[p].env)) assert.ok(!prod.includes(v), `${p} carries a production value`)
  for (const p of ["development", "preview", "production", "local"]) for (const v of Object.values(eas.build[p].env)) assert.ok(!/staging/.test(v), `${p} carries a staging value`)
})
test("OTA updates are NOT enabled: no channel, no expo-updates dependency, updates stay disabled in the manifest", () => {
  for (const p of Object.values(eas.build)) { assert.ok(!("channel" in p)); assert.ok(!("runtimeVersion" in p)) }
  const pkg = JSON.parse(read("package.json")); assert.ok(!("expo-updates" in { ...pkg.dependencies, ...pkg.devDependencies }))
  assert.match(read("android/app/src/main/AndroidManifest.xml"), /expo\.modules\.updates\.ENABLED" android:value="false"/)
  assert.ok(!("updates" in JSON.parse(read("app.json")).expo)); assert.ok(!("runtimeVersion" in JSON.parse(read("app.json")).expo))
})
test("the EAS pre-install hook runs the environment check", () => assert.equal(JSON.parse(read("package.json")).scripts["eas-build-pre-install"], "node scripts/verify-env.js"))

test("Gradle flavors: literal application ids equal the allow-list; no suffix trick; the default id is unchanged", () => {
  const flavors = block(gradle, "productFlavors")
  assert.match(block(flavors, "production"), new RegExp(`applicationId '${CFG.ENVIRONMENTS.production.androidApplicationId.replace(/\./g, "\\.")}'`))
  assert.match(block(flavors, "staging"), new RegExp(`applicationId '${CFG.ENVIRONMENTS.staging.androidApplicationId.replace(/\./g, "\\.")}'`))
  assert.ok(!/applicationIdSuffix/.test(gradle)); assert.match(gradle, /flavorDimensions "environment"/)
  assert.match(block(gradle, "defaultConfig"), /applicationId 'com\.sbudamalloya\.xploresoweto'/); assert.match(gradle, /namespace 'com\.sbudamalloya\.xploresoweto'/)
  assert.equal(JSON.parse(read("app.json")).expo.android.package, "com.sbudamalloya.xploresoweto")
})
test("SIGNING: production keeps today's behaviour; staging release never falls back to debug; the guard refuses a debug-signed or unsigned staging release", () => {
  const flavors = block(gradle, "productFlavors"), staging = block(flavors, "staging"), production = block(flavors, "production")
  assert.match(production, /signingConfig signingConfigs\.debug/) // identical effective signing for production
  assert.match(staging, /signingConfig signingConfigs\.staging/); assert.ok(!/debug/.test(staging))
  assert.ok(!/signingConfig\s/.test(block(block(gradle, "buildTypes"), "release")), "release build type no longer pins debug signing for every flavor")
  assert.match(block(block(gradle, "buildTypes"), "debug"), /signingConfigs\.debug/)
  const s = block(block(gradle, "signingConfigs"), "staging")
  assert.ok(!/debug/.test(s)); for (const k of ["XS_STAGING_STORE_FILE", "XS_STAGING_STORE_PASSWORD", "XS_STAGING_KEY_ALIAS", "XS_STAGING_KEY_PASSWORD"]) assert.ok(s.includes(k), k)
  assert.ok(!/storePassword\s+['"]/.test(s) && !/keyPassword\s+['"]/.test(s), "no literal password")
  const g = gradle.slice(gradle.indexOf("gradle.taskGraph.whenReady"))
  for (const needle of ["StagingRelease", "cfg.name == 'debug'", "debug.keystore", "cfg.storeFile == null", "GradleException"]) assert.ok(g.includes(needle), needle)
})
test("the tracked debug keystore is untouched and only the debug configuration references it", () => {
  assert.ok(fs.existsSync(path.join(root, "android/app/debug.keystore")))
  assert.deepEqual(gradle.match(/storeFile file\('debug\.keystore'\)/g), ["storeFile file('debug.keystore')"])
  const kinds = fs.readdirSync(root).filter((f) => /\.(jks|keystore|p12)$/.test(f)); assert.deepEqual(kinds, [])
  assert.ok(!fs.readdirSync(path.join(root, "android/app")).some((f) => /staging/i.test(f) && /\.(jks|keystore|p12)$/.test(f)), "no staging keystore in the repository")
})
test("the staging app is labelled differently, the production label is unchanged", () => {
  assert.match(read("android/app/src/staging/res/values/strings.xml"), /<string name="app_name">XploreSoweto STAGING<\/string>/)
  assert.match(read("android/app/src/main/res/values/strings.xml"), /<string name="app_name">xploresoweto<\/string>/)
})
test("verify-env: production profiles pass, staging fails closed until its identifiers exist, unknown/mismatched profiles fail", () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [path.join(root, "scripts", "verify-env.js"), ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" })
  for (const p of ["development", "preview", "production", "local"]) assert.equal(run([p]).status, 0, p)
  const configured = CFG.ENVIRONMENTS.staging.firebase.apiKey !== null
  assert.equal(run(["staging"]).status, configured ? 0 : 1); if (!configured) assert.match(run(["staging"]).stderr, /not configured yet/)
  assert.equal(run(["nonsense"]).status, 1); assert.equal(run([]).status, 0) // no profile = not an EAS build
  const wrong = run([], { EAS_BUILD_PROFILE: "staging", ...varsFor("production") }); assert.equal(wrong.status, 1) // staging profile with production variables
  const wrong2 = run([], { EAS_BUILD_PROFILE: "production", ...varsFor("staging") }); assert.equal(wrong2.status, 1)
  assert.equal(run([], { EAS_BUILD_PROFILE: "production", ...varsFor("production") }).status, 0)
})
test("checkProfile catches a profile pointed at the wrong flavor or carrying the wrong environment", () => {
  const bad = JSON.parse(JSON.stringify(eas)); bad.build.staging.android.gradleCommand = ":app:assembleProductionRelease"
  assert.ok(checkProfile(bad, "staging").some((x) => /flavor/.test(x)))
  const bad2 = JSON.parse(JSON.stringify(eas)); bad2.build.production.env = varsFor("staging")
  assert.ok(checkProfile(bad2, "production").length > 0)
  const bad3 = JSON.parse(JSON.stringify(eas)); bad3.build.production.env = { ...varsFor("production"), EXPO_PUBLIC_EXTRA: "x" }
  assert.ok(checkProfile(bad3, "production").some((x) => /EXPO_PUBLIC_EXTRA/.test(x)))
})
