"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setup, req, anon, rejects } = require("./helpers")
const { ensureUserProfile } = require("../src/handlers/profile")

let env
beforeEach(() => { env = setup() })

test("ensureUserProfile requires authentication", async () => {
  await rejects(ensureUserProfile(anon({})), "unauthenticated")
})
test("creates users/{uid} from the verified token, not from client input", async () => {
  const r = await ensureUserProfile(req("u1", { displayName: "Thabo" }, { email: "Thabo@Example.com" }))
  assert.equal(r.created, true)
  const d = env.get("users/u1")
  assert.equal(d.uid, "u1"); assert.equal(d.email, "thabo@example.com"); assert.equal(d.displayName, "Thabo")
  assert.equal(d.enrolled, false); assert.equal(d.schemaVersion, 1); assert.ok(d.createdAt && d.updatedAt)
  for (const k of ["role", "roles", "permissions", "superAdmin", "isAdmin", "canReview", "organisationId"]) assert.ok(!(k in d), `${k} must not exist`)
})
test("falls back to the email prefix when no display name is supplied", async () => {
  await ensureUserProfile(req("u2", {}, { email: "sipho.m@example.com" }))
  assert.equal(env.get("users/u2").displayName, "sipho.m")
})
test("rejects unknown or privileged fields", async () => {
  for (const bad of [{ role: "super_admin" }, { isAdmin: true }, { permissions: ["x"] }, { canReview: true }, { email: "x@y.com" }, { uid: "other" }]) {
    await rejects(ensureUserProfile(req("u3", bad)), "invalid-argument")
  }
  assert.equal(env.get("users/u3"), undefined)
})
test("validates accepted fields", async () => {
  await rejects(ensureUserProfile(req("u4", { displayName: "x".repeat(61) })), "invalid-argument")
  await rejects(ensureUserProfile(req("u4", { phone: "abc" })), "invalid-argument")
  await rejects(ensureUserProfile(req("u4", { displayName: 42 })), "invalid-argument")
  await rejects(ensureUserProfile(req("u4", { displayName: "bad\u0007name" })), "invalid-argument")
})
test("is idempotent: a retry never overwrites an existing profile", async () => {
  await ensureUserProfile(req("u5", { displayName: "First", kasi: "Orlando" }))
  env.db._write({ type: "update", path: "users/u5", data: { enrolled: true, phone: "0110000000" } }) // user progressed
  const r = await ensureUserProfile(req("u5", { displayName: "Second", kasi: "Diepkloof" }))
  assert.equal(r.created, false)
  const d = env.get("users/u5")
  assert.equal(d.displayName, "First"); assert.equal(d.kasi, "Orlando"); assert.equal(d.enrolled, true); assert.equal(d.phone, "0110000000")
})
test("concurrent calls (two devices, double tap) produce exactly one profile", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => ensureUserProfile(req("u6", { displayName: "Racer" }))))
  assert.equal(results.filter((r) => r.created).length, 1)
  assert.equal(env.list("users").length, 1)
})
test("the Auth-succeeded-but-profile-missing case recovers by simply calling again", async () => {
  // Auth account exists (token present) but no users doc yet: first call fails nowhere, creates it; later calls are no-ops
  assert.equal(env.get("users/u7"), undefined)
  assert.equal((await ensureUserProfile(req("u7", {}))).created, true)
  assert.equal((await ensureUserProfile(req("u7", {}))).created, false)
})
