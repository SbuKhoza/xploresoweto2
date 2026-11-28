"use strict"

const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const readline = require("readline")
const { varsFor } = require("../lib/envVars")

const root = path.resolve(__dirname, "../..")
process.chdir(root)

function fail(message) {
  console.error("BLOCKED: " + message)
  process.exit(1)
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8"
  }).trim()
}

const branch = git(["branch", "--show-current"])

if (!branch.startsWith("staging/")) {
  fail("Updates must originate from a staging branch.")
}

if (git(["status", "--porcelain"])) {
  fail("Commit your changes before publishing.")
}

const baselineTag = "staging-ota-runtime-1"
let baseline

try {
  baseline = git(["rev-parse", "--verify", baselineTag + "^{commit}"])
} catch {
  fail("No verified OTA-enabled APK baseline exists yet.")
}

try {
  git(["merge-base", "--is-ancestor", baseline, "HEAD"])
} catch {
  fail("The verified APK baseline is not an ancestor of HEAD.")
}

const changed = git([
  "diff", "--name-only", baseline, "HEAD"
]).split(/\r?\n/).filter(Boolean)

const nativeChanges = changed.filter(file =>
  /^(android\/|ios\/|plugins\/|patches\/)/.test(file) ||
  /^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|app\.json|app\.config\..+|eas\.json|metro\.config\..+|babel\.config\..+|react-native\.config\..+)$/.test(file)
)

if (nativeChanges.length) {
  fail("Potentially incompatible changes:\n" +
    nativeChanges.join("\n") +
    "\nReview native compatibility and build a new APK if required.")
}

const app = require("../../app.json").expo
const eas = require("../../eas.json")

if (
  app.runtimeVersion !== "staging-1" ||
  app.extra?.eas?.projectId !==
    "9ca91ae0-7d47-40c4-8299-80b8595e5f27" ||
  app.updates?.url !==
    "https://u.expo.dev/9ca91ae0-7d47-40c4-8299-80b8595e5f27" ||
  eas.build.staging.channel !== "staging"
) {
  fail("Unexpected OTA configuration.")
}

const env = { ...process.env }

for (const key of Object.keys(env)) {
  if (key.startsWith("EXPO_PUBLIC_")) delete env[key]
}

Object.assign(env, varsFor("staging"))
env.EXPO_NO_DOTENV = "1"

if (
  env.EXPO_PUBLIC_APP_ENV !== "staging" ||
  env.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== "xploresoweto-staging" ||
  env.EXPO_PUBLIC_AI_ASSISTANT !== "true"
) {
  fail("Staging environment validation failed.")
}

const message = process.argv.slice(2).join(" ").trim()

if (!message) {
  fail("Provide an update description.")
}

console.log("OTA preflight passed.")
console.log("Branch: " + branch)
console.log("Runtime: staging-1")
console.log("Channel: staging")
console.log("Firebase: xploresoweto-staging")
console.log("Platform: Android")
console.log("Message: " + message)

console.log("\nPublishing remains disabled until the first APK is verified.")