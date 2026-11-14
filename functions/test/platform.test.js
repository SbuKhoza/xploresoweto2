"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setup, req, rejects, makeSuperAdmin } = require("./helpers")
const G = require("../src/lib/guards")
const { managePlatformRole } = require("../src/handlers/platform")
const { seedLoadshedding } = require("../src/handlers/loadshedding")

let env
beforeEach(() => { env = setup() })

test("guard: valid super admin (claim + active record + verified) passes", async () => {
  const sa = makeSuperAdmin(env, "root")
  assert.equal((await G.requireActiveSuperAdmin(sa({}))).uid, "root")
})
test("guard: unauthenticated denied", async () => { await rejects(G.requireActiveSuperAdmin({ data: {} }), "unauthenticated") })
test("guard: claim WITHOUT an active record is denied", async () => {
  env.addUser("fake")
  await rejects(G.requireActiveSuperAdmin(req("fake", {}, { claims: { superAdmin: true } })), "permission-denied")
})
test("guard: inactive record is denied even with the claim", async () => {
  const sa = makeSuperAdmin(env, "ex", { active: false })
  await rejects(G.requireActiveSuperAdmin(sa({})), "permission-denied")
})
test("guard: active record WITHOUT the claim is denied", async () => {
  const sa = makeSuperAdmin(env, "noclaim", { claim: false })
  await rejects(G.requireActiveSuperAdmin(sa({})), "permission-denied")
})
test("guard: record with the wrong role or mismatched uid is denied", async () => {
  const sa = makeSuperAdmin(env, "wrongrole", { role: "editor" })
  await rejects(G.requireActiveSuperAdmin(sa({})), "permission-denied")
  env.addUser("mismatch", { customClaims: { superAdmin: true } })
  env.seed("super-admin/mismatch", { uid: "someone-else", role: "super_admin", active: true })
  await rejects(G.requireActiveSuperAdmin(req("mismatch", {}, { claims: { superAdmin: true } })), "permission-denied")
})
test("guard: unverified email is refused", async () => {
  const sa = makeSuperAdmin(env, "unv")
  await rejects(G.requireActiveSuperAdmin(sa({}, { verified: false })), "failed-precondition", "email-not-verified")
})
test("guard: a user can never grant themselves access by sending claims-like data", async () => {
  env.addUser("evil")
  await rejects(managePlatformRole(req("evil", { action: "add", role: "superAdmin", uid: "evil", isAdmin: true })), "permission-denied")
  assert.equal(env.get("super-admin/evil"), undefined)
})
test("editors cannot manage platform roles", async () => {
  env.addUser("ed", { customClaims: { editor: true } })
  env.seed("platform-editors/ed", { uid: "ed", role: "editor", active: true })
  await rejects(managePlatformRole(req("ed", { action: "add", role: "editor", uid: "ed" }, { claims: { editor: true } })), "permission-denied")
})
test("add: creates the authoritative record, derives the claim, audits once; repeat is a no-op", async () => {
  const sa = makeSuperAdmin(env, "root"); env.addUser("second")
  const r = await managePlatformRole(sa({ action: "add", role: "superAdmin", uid: "second" }))
  assert.equal(r.changed, true)
  const rec = env.get("super-admin/second")
  assert.deepEqual([rec.uid, rec.role, rec.active, rec.grantedBy, rec.email], ["second", "super_admin", true, "root", "second@example.com"])
  assert.deepEqual(env.auth.users.get("second").customClaims, { superAdmin: true })
  assert.equal(env.list("audit-log").length, 1)
  const again = await managePlatformRole(sa({ action: "add", role: "superAdmin", uid: "second" }))
  assert.equal(again.changed, false); assert.equal(env.list("audit-log").length, 1)
})
test("add: target must exist and have a verified email", async () => {
  const sa = makeSuperAdmin(env, "root")
  await rejects(managePlatformRole(sa({ action: "add", role: "editor", uid: "ghost" })), "not-found")
  env.addUser("unv", { emailVerified: false })
  await rejects(managePlatformRole(sa({ action: "add", role: "editor", uid: "unv" })), "failed-precondition", "target-email-not-verified")
})
test("add: a claim lost earlier is repaired by repeating the call", async () => {
  const sa = makeSuperAdmin(env, "root"); env.addUser("x")
  env.seed("platform-editors/x", { uid: "x", role: "editor", active: true })
  const r = await managePlatformRole(sa({ action: "add", role: "editor", uid: "x" }))
  assert.equal(r.changed, false); assert.equal(r.claimChanged, true)
  assert.deepEqual(env.auth.users.get("x").customClaims, { editor: true })
})
test("remove: the last active super admin cannot be removed; self-removal is refused", async () => {
  const sa = makeSuperAdmin(env, "root")
  await rejects(managePlatformRole(sa({ action: "remove", role: "superAdmin", uid: "root" })), "failed-precondition", "cannot-remove-self")
  env.addUser("b"); await managePlatformRole(sa({ action: "add", role: "superAdmin", uid: "b" }))
  // b tries to remove root while both active: allowed (two admins). Then root remains the only one -> can't remove it
  const sb = (d) => req("b", d, { claims: { superAdmin: true } })
  await managePlatformRole(sb({ action: "remove", role: "superAdmin", uid: "root" }))
  await rejects(managePlatformRole(sb({ action: "remove", role: "superAdmin", uid: "b" })), "failed-precondition", "cannot-remove-self")
  env.addUser("c", {}); env.seed("super-admin/c", { uid: "c", role: "super_admin", active: true })
  await managePlatformRole(sb({ action: "remove", role: "superAdmin", uid: "c" }))
  const onlyOne = env.list("super-admin").filter((x) => x.active)
  assert.equal(onlyOne.length, 1)
  // two admins -> a third party cannot reduce below one
  env.addUser("d"); await managePlatformRole(sb({ action: "add", role: "superAdmin", uid: "d" }))
  const sd = (data) => req("d", data, { claims: { superAdmin: true } })
  await managePlatformRole(sd({ action: "remove", role: "superAdmin", uid: "b" }))
  await rejects(managePlatformRole(req("b", { action: "remove", role: "superAdmin", uid: "d" }, { claims: { superAdmin: true } })), "permission-denied") // b was revoked: stale token claim is useless
})
test("last-admin protection holds even when the caller is a different (stale) admin record", async () => {
  const sa = makeSuperAdmin(env, "only")
  env.addUser("target"); env.seed("super-admin/target", { uid: "target", role: "super_admin", active: false })
  // only one active admin exists (caller). Removing someone else who is inactive is a no-op, not an error
  const r = await managePlatformRole(sa({ action: "remove", role: "superAdmin", uid: "target" }))
  assert.equal(r.changed, false)
})
test("revocation takes effect immediately: claim cleared, sessions revoked, stale token denied", async () => {
  const sa = makeSuperAdmin(env, "root"); env.addUser("b")
  await managePlatformRole(sa({ action: "add", role: "superAdmin", uid: "b" }))
  await managePlatformRole(sa({ action: "remove", role: "superAdmin", uid: "b" }))
  assert.equal(env.get("super-admin/b").active, false)
  assert.equal(env.auth.users.get("b").customClaims, undefined)
  assert.deepEqual(env.auth.revoked, ["b"])
  await rejects(G.requireActiveSuperAdmin(req("b", {}, { claims: { superAdmin: true } })), "permission-denied")
})
test("seedLoadshedding: super admin only, validates, never overwrites by default, audits", async () => {
  const sa = makeSuperAdmin(env, "root"); env.addUser("u")
  const item = { suburb: "Orlando East", schedule: { stage_1: { monday: ["06:00 - 08:30"], tuesday: [] } } }
  await rejects(seedLoadshedding(req("u", { schedules: [item] })), "permission-denied")
  await rejects(seedLoadshedding(sa({ schedules: [] })), "invalid-argument")
  await rejects(seedLoadshedding(sa({ schedules: [{ suburb: "X", schedule: { stage_9: {} } }] })), "invalid-argument")
  await rejects(seedLoadshedding(sa({ schedules: [{ suburb: "X", schedule: { stage_1: { monday: ["bad"] } } }] })), "invalid-argument")
  await rejects(seedLoadshedding(sa({ schedules: [item], extra: 1 })), "invalid-argument")
  const r = await seedLoadshedding(sa({ schedules: [item] }))
  assert.deepEqual([r.created, r.skipped], [1, 0])
  const doc = env.get("loadshedding/orlando east")
  assert.equal(doc.isActive, true); assert.equal(doc.seededBy, "root")
  const changed = { ...item, schedule: { stage_1: { monday: ["10:00 - 12:30"] } } }
  const again = await seedLoadshedding(sa({ schedules: [changed] }))
  assert.deepEqual([again.created, again.skipped], [0, 1])
  assert.deepEqual(env.get("loadshedding/orlando east").schedule.stage_1.monday, ["06:00 - 08:30"]) // untouched
  await rejects(seedLoadshedding(sa({ schedules: [changed], overwrite: true })), "invalid-argument")
  const ow = await seedLoadshedding(sa({ schedules: [changed], overwrite: true, confirmOverwrite: "OVERWRITE" }))
  assert.equal(ow.overwritten, 1)
  assert.deepEqual(env.get("loadshedding/orlando east").schedule.stage_1.monday, ["10:00 - 12:30"])
})

test("RACE: two super admins removing each other at the same moment can never leave zero active super admins", async () => {
  const sa = makeSuperAdmin(env, "a"); const sb = makeSuperAdmin(env, "b")
  for (let round = 0; round < 3; round++) {
    env.seed("super-admin/a", { uid: "a", email: "a@example.com", role: "super_admin", active: true })
    env.seed("super-admin/b", { uid: "b", email: "b@example.com", role: "super_admin", active: true })
    const results = await Promise.allSettled([
      managePlatformRole(sa({ action: "remove", role: "superAdmin", uid: "b" })),
      managePlatformRole(sb({ action: "remove", role: "superAdmin", uid: "a" })),
    ])
    const active = env.list("super-admin").filter((x) => x.active).length
    assert.ok(active >= 1, `round ${round}: ${active} active super admins remain`)
    assert.ok(results.some((r) => r.status === "rejected" && /last-super-admin/.test(r.reason.message)), "one of the two removals must be refused")
  }
})
