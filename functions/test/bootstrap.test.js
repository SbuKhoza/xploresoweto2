"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setup } = require("./helpers")
const lib = require("../src/lib/bootstrap")

let env
const yes = async () => true
const rec = (o = {}) => ({ uid: "root", email: "root@example.com", displayName: "Root", role: "super_admin", active: true, grantedBy: "manual-bootstrap", ...o })
beforeEach(() => { env = setup(); env.addUser("root") })
const refuses = (p, re) => assert.rejects(p, (e) => { assert.ok(e.bootstrap, `expected a controlled error, got: ${e.message}`); assert.match(e.message, re); return true })

test("bootstrap refuses without an explicit uid (never chooses an account)", async () => { await refuses(lib.bootstrap({ confirm: yes }), /--uid is required/) })
test("bootstrap refuses when the Authentication account does not exist", async () => { await refuses(lib.bootstrap({ uid: "ghost", confirm: yes }), /No Firebase Authentication account/) })
test("bootstrap refuses when the manual record is missing, and does NOT create it", async () => {
  await refuses(lib.bootstrap({ uid: "root", confirm: yes }), /No document super-admin\/root exists/)
  assert.equal(env.get("super-admin/root"), undefined); assert.equal(env.auth.users.get("root").customClaims, undefined)
})
test("bootstrap refuses a malformed record: wrong uid field, wrong role, inactive, email mismatch, disabled account", async () => {
  env.seed("super-admin/root", rec({ uid: "other" })); await refuses(lib.bootstrap({ uid: "root", confirm: yes }), /must equal the document id/)
  env.seed("super-admin/root", rec({ role: "admin" })); await refuses(lib.bootstrap({ uid: "root", confirm: yes }), /"super_admin"/)
  env.seed("super-admin/root", rec({ active: false })); await refuses(lib.bootstrap({ uid: "root", confirm: yes }), /must be true/)
  env.seed("super-admin/root", rec({ email: "someone@else.com" })); await refuses(lib.bootstrap({ uid: "root", confirm: yes }), /does not match/)
  env.seed("super-admin/root", rec()); env.auth.users.get("root").disabled = true; await refuses(lib.bootstrap({ uid: "root", confirm: yes }), /disabled/)
  assert.equal(env.auth.users.get("root").customClaims, undefined)
})
test("bootstrap needs confirmation; without it nothing changes", async () => {
  env.seed("super-admin/root", rec())
  await refuses(lib.bootstrap({ uid: "root", confirm: async () => false }), /Not confirmed/)
  assert.equal(env.auth.users.get("root").customClaims, undefined)
})
test("bootstrap sets and VERIFIES the claim, audits once, leaves the record untouched, and is idempotent", async () => {
  env.seed("super-admin/root", rec()); const before = JSON.stringify(env.get("super-admin/root"))
  const r = await lib.bootstrap({ uid: "root", confirm: yes })
  assert.deepEqual([r.claimChanged, r.claimVerified, r.emailVerified], [true, true, true])
  assert.deepEqual(env.auth.users.get("root").customClaims, { superAdmin: true })
  assert.equal(JSON.stringify(env.get("super-admin/root")), before) // read-only for the authoritative record
  assert.equal(env.list("audit-log").length, 1); assert.equal(env.list("audit-log")[0].action, "platform.superAdmin.bootstrap")
  const again = await lib.bootstrap({ uid: "root", confirm: yes })
  assert.equal(again.claimChanged, false); assert.equal(env.list("audit-log").length, 1)
  assert.equal(env.list("super-admin").length, 1) // no extra records were created
})
test("an unverified admin account is allowed ONLY as a documented exception: flagged in the audit entry and in the result", async () => {
  env.addUser("fresh", { emailVerified: false }); env.seed("super-admin/fresh", rec({ uid: "fresh", email: "fresh@example.com" }))
  const r = await lib.bootstrap({ uid: "fresh", confirm: yes })
  assert.equal(r.emailVerified, false)
  assert.deepEqual([env.list("audit-log")[0].details.exception, env.list("audit-log")[0].details.emailVerified], [true, false])
})
test("bootstrap refuses to add a second active super admin unless --allow-multiple is given", async () => {
  env.seed("super-admin/root", rec()); env.addUser("b"); env.seed("super-admin/b", rec({ uid: "b", email: "b@example.com" }))
  await refuses(lib.bootstrap({ uid: "root", confirm: yes }), /Other active super-admin records exist/)
  assert.equal((await lib.bootstrap({ uid: "root", allowMultiple: true, confirm: yes })).claimVerified, true)
})
test("sync clears the claim when the record is inactive; status reports orphans and drift", async () => {
  env.seed("super-admin/root", rec()); await lib.bootstrap({ uid: "root", confirm: yes })
  env.db._write({ type: "update", path: "super-admin/root", data: { active: false } })
  const drift = await lib.status(); assert.ok(drift[0].problems.some((p) => /inactive but claim present/.test(p)))
  await lib.syncOne("root"); assert.equal(env.auth.users.get("root").customClaims, undefined)
  env.seed("super-admin/orphan", rec({ uid: "orphan", email: "o@example.com" }))
  assert.ok((await lib.status()).find((r) => r.uid === "orphan").problems.some((p) => /ORPHAN/.test(p)))
})
