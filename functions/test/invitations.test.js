"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setup, req, rejects, makeOrg, addMember } = require("./helpers")
const { sha256hex } = require("../src/lib/crypto")
const inv = require("../src/handlers/invitations")
const mem = require("../src/handlers/members")

let env
beforeEach(() => {
  env = setup()
  makeOrg(env, "orgA", { name: "Org A" }); makeOrg(env, "orgX", { name: "Org X" })
  addMember(env, "orgA", "owner", "owner"); addMember(env, "orgA", "mgr", "manager"); addMember(env, "orgA", "emp", "employee"); addMember(env, "orgA", "mgr2", "manager")
  addMember(env, "orgX", "xowner", "owner")
  env.addUser("newbie", { email: "newbie@example.com" }); env.addUser("stranger"); env.addUser("unverified", { emailVerified: false })
})
const invite = (uid, data) => inv.inviteOrganisationMember(req(uid, { organisationId: "orgA", email: "newbie@example.com", role: "employee", ...data }))

test("invite: unverified, non-member, other-organisation and no-permission callers are refused", async () => {
  await rejects(inv.inviteOrganisationMember(req("owner", { organisationId: "orgA", email: "n@example.com", role: "employee" }, { verified: false })), "failed-precondition", "email-not-verified")
  await rejects(invite("stranger", {}), "permission-denied")
  await rejects(invite("xowner", {}), "permission-denied") // owner of ANOTHER organisation
  await rejects(invite("emp", {}), "permission-denied") // employee lacks members.manage
  assert.equal(env.list("organisation-invitations").length, 0)
})
test("invite: stores only a hash of a random token; the id and path never contain the email", async () => {
  const r = await invite("owner", {})
  assert.ok(r.token.length >= 40)
  const docs = env.list("organisation-invitations"); assert.equal(docs.length, 1)
  const d = docs[0]
  assert.equal(d.tokenHash, sha256hex(r.token)); assert.ok(!("token" in d)); assert.ok(!JSON.stringify(d).includes(r.token))
  assert.ok(!r.invitationId.includes("newbie") && !r.invitationId.includes("@")); assert.equal(r.invitationId, d.id)
  assert.equal(d.status, "pending"); assert.ok(d.expiresAt.toMillis() > env.time.now)
  assert.deepEqual(d.permissions, ["bookings.read"]) // resolved server-side from the role
  const t2 = (await invite("owner", {})).token
  assert.notEqual(t2, r.token); assert.equal(env.list("organisation-invitations").length, 1) // re-invite refreshes, no duplicate
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { token: r.token, invitationId: r.invitationId })), "not-found") // old token dead
})
test("invite: role limits (managers cannot create managers/owners), no self-invite, duplicate member refused", async () => {
  await invite("mgr", { role: "content_manager" })
  await rejects(invite("mgr", { email: "a@example.com", role: "manager" }), "permission-denied", "role-not-assignable")
  await rejects(invite("mgr", { email: "a@example.com", role: "owner" }), "permission-denied", "role-not-assignable")
  await invite("owner", { email: "a@example.com", role: "manager" })
  await rejects(inv.inviteOrganisationMember(req("owner", { organisationId: "orgA", email: "owner@example.com", role: "employee" })), "invalid-argument")
  await rejects(invite("owner", { email: "emp@example.com" }), "already-exists", "already-member")
  await rejects(invite("owner", { role: "superuser" }), "invalid-argument")
})
test("invite: pending invitations are capped per organisation", async () => {
  for (let i = 0; i < 50; i++) await invite("owner", { email: `p${i}@example.com` })
  await rejects(invite("owner", { email: "one-too-many@example.com" }), "resource-exhausted")
})
test("list: only members with members.manage see invitations, emails are masked, other organisations see nothing", async () => {
  await invite("owner", {})
  const l = await inv.listOrganisationInvitations(req("mgr", { organisationId: "orgA" }))
  assert.equal(l.invitations.length, 1); assert.equal(l.invitations[0].email, "n***@example.com"); assert.ok(!JSON.stringify(l).includes("newbie"))
  await rejects(inv.listOrganisationInvitations(req("emp", { organisationId: "orgA" })), "permission-denied")
  await rejects(inv.listOrganisationInvitations(req("xowner", { organisationId: "orgA" })), "permission-denied")
})
test("accept (in-app): needs a VERIFIED email equal to the invited email; creates the membership server-side", async () => {
  const r = await invite("owner", { role: "reservations_manager" })
  await rejects(inv.acceptOrganisationInvitation(req("stranger", { invitationId: r.invitationId })), "not-found") // wrong recipient
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { invitationId: r.invitationId }, { verified: false })), "failed-precondition", "email-not-verified")
  const ok = await inv.acceptOrganisationInvitation(req("newbie", { invitationId: r.invitationId }))
  assert.equal(ok.alreadyMember, false)
  const m = env.get("organisation-members/orgA_newbie")
  assert.deepEqual([m.role, m.active, m.userId, m.invitedBy], ["reservations_manager", true, "newbie", "owner"])
  assert.deepEqual(m.permissions, ["bookings.read", "bookings.manage", "enquiries.manage"])
  assert.equal(env.get(`organisation-invitations/${r.invitationId}`).status, "accepted")
  assert.equal(env.list("audit-log").filter((a) => a.action === "organisation.member.add").length, 1)
})
test("accept (token): single-use, bound to the recipient, constant-time compared", async () => {
  const r = await invite("owner", {})
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { token: "x".repeat(43) })), "not-found")
  await rejects(inv.acceptOrganisationInvitation(req("stranger", { token: r.token })), "not-found") // right token, wrong person
  await inv.acceptOrganisationInvitation(req("newbie", { token: r.token }))
  const retry = await inv.acceptOrganisationInvitation(req("newbie", { token: r.token })) // same user, lost response -> safe
  assert.equal(retry.alreadyMember, true); assert.equal(env.list("organisation-members").filter((m) => m.userId === "newbie").length, 1)
  env.addUser("other", { email: "other@example.com" })
  await rejects(inv.acceptOrganisationInvitation(req("other", { token: r.token })), "not-found") // reuse by another user
})
test("accept: after the member was removed the old invitation cannot be reused", async () => {
  const r = await invite("owner", {})
  await inv.acceptOrganisationInvitation(req("newbie", { invitationId: r.invitationId }))
  await mem.removeOrganisationMember(req("owner", { organisationId: "orgA", userId: "newbie" }))
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { invitationId: r.invitationId })), "failed-precondition", "invitation-used")
})
test("accept: expired, revoked and declined invitations are refused", async () => {
  const r = await invite("owner", {})
  env.time.now += 8 * 86400000
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { invitationId: r.invitationId })), "failed-precondition", "invitation-expired")
  assert.equal((await inv.listMyInvitations(req("newbie", {}))).invitations.length, 0) // expired ones are not listed
  env.time.now -= 8 * 86400000
  await inv.revokeOrganisationInvitation(req("owner", { organisationId: "orgA", invitationId: r.invitationId }))
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { invitationId: r.invitationId })), "failed-precondition", "invitation-revoked")
  const r2 = await invite("owner", {}) // re-inviting after revocation works
  await inv.declineOrganisationInvitation(req("newbie", { invitationId: r2.invitationId }))
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { invitationId: r2.invitationId })), "failed-precondition", "invitation-declined")
})
test("accept: an invitation to a suspended organisation cannot be accepted", async () => {
  const r = await invite("owner", {})
  env.db._write({ type: "update", path: "organisations/orgA", data: { approvalStatus: "suspended", active: false } })
  await rejects(inv.acceptOrganisationInvitation(req("newbie", { invitationId: r.invitationId })), "failed-precondition", "organisation-inactive")
})
test("revoke: scoped to the organisation and to the caller's authority; idempotent", async () => {
  const mgrInvite = await invite("owner", { email: "m@example.com", role: "manager" })
  await rejects(inv.revokeOrganisationInvitation(req("mgr", { organisationId: "orgA", invitationId: mgrInvite.invitationId })), "permission-denied", "role-not-assignable")
  await rejects(inv.revokeOrganisationInvitation(req("xowner", { organisationId: "orgX", invitationId: mgrInvite.invitationId })), "not-found") // other org's invite
  assert.equal((await inv.revokeOrganisationInvitation(req("owner", { organisationId: "orgA", invitationId: mgrInvite.invitationId }))).changed, true)
  assert.equal((await inv.revokeOrganisationInvitation(req("owner", { organisationId: "orgA", invitationId: mgrInvite.invitationId }))).changed, false)
})
test("listMyInvitations returns only the caller's own invitations", async () => {
  await invite("owner", {}); await invite("owner", { email: "someoneelse@example.com" })
  const mine = await inv.listMyInvitations(req("newbie", {}))
  assert.equal(mine.invitations.length, 1); assert.equal(mine.invitations[0].organisationName, "Org A")
  assert.equal((await inv.listMyInvitations(req("stranger", {}))).invitations.length, 0)
})

// ---- members: privilege escalation and isolation
test("setMemberRole: managers cannot promote to manager/owner, cannot touch managers, cannot change their own role", async () => {
  await mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "emp", role: "content_manager" }))
  assert.equal(env.get("organisation-members/orgA_emp").role, "content_manager")
  await rejects(mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "emp", role: "manager" })), "permission-denied")
  await rejects(mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "emp", role: "owner" })), "permission-denied")
  await rejects(mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "mgr2", role: "employee" })), "permission-denied")
  await rejects(mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "owner", role: "employee" })), "permission-denied")
  await rejects(mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "mgr", role: "owner" })), "failed-precondition", "cannot-change-own-role")
  await rejects(mem.setMemberRole(req("emp", { organisationId: "orgA", userId: "emp", role: "owner" })), "permission-denied")
  assert.equal(env.get("organisation-members/orgA_mgr").role, "manager")
})
test("setMemberRole: owners can promote; the permission set follows the role and is never client-supplied", async () => {
  await mem.setMemberRole(req("owner", { organisationId: "orgA", userId: "emp", role: "manager" }))
  assert.ok(env.get("organisation-members/orgA_emp").permissions.includes("members.manage"))
  await rejects(mem.setMemberRole(req("owner", { organisationId: "orgA", userId: "emp", role: "manager", permissions: ["members.manage"] })), "invalid-argument")
  assert.equal(env.list("audit-log").filter((a) => a.action === "organisation.member.role").length, 1)
  const noop = await mem.setMemberRole(req("owner", { organisationId: "orgA", userId: "emp", role: "manager" }))
  assert.equal(noop.changed, false); assert.equal(env.list("audit-log").filter((a) => a.action === "organisation.member.role").length, 1)
})
test("last owner: cannot be demoted or removed or leave; a second owner makes it possible", async () => {
  await rejects(mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "owner", role: "employee" })), "permission-denied")
  addMember(env, "orgA", "owner2", "owner")
  await mem.setMemberRole(req("owner2", { organisationId: "orgA", userId: "owner", role: "manager" })) // two owners: ok
  await rejects(mem.setMemberRole(req("owner2", { organisationId: "orgA", userId: "owner2", role: "manager" })), "failed-precondition", "cannot-change-own-role")
  await rejects(mem.removeOrganisationMember(req("owner2", { organisationId: "orgA", userId: "owner2" })), "failed-precondition", "last-owner") // now the ONLY owner
  await rejects(mem.setMemberRole(req("mgr", { organisationId: "orgA", userId: "owner2", role: "employee" })), "permission-denied")
})
test("remove: hierarchy, self-leave, idempotency", async () => {
  await rejects(mem.removeOrganisationMember(req("mgr", { organisationId: "orgA", userId: "mgr2" })), "permission-denied")
  await rejects(mem.removeOrganisationMember(req("mgr", { organisationId: "orgA", userId: "owner" })), "permission-denied")
  await rejects(mem.removeOrganisationMember(req("emp", { organisationId: "orgA", userId: "mgr" })), "permission-denied")
  assert.equal((await mem.removeOrganisationMember(req("mgr", { organisationId: "orgA", userId: "emp" }))).changed, true)
  assert.equal((await mem.removeOrganisationMember(req("mgr", { organisationId: "orgA", userId: "emp" }))).changed, false)
  assert.equal((await mem.removeOrganisationMember(req("mgr2", { organisationId: "orgA", userId: "mgr2" }))).changed, true) // leaving
  await rejects(mem.removeOrganisationMember(req("owner", { organisationId: "orgA", userId: "owner" })), "failed-precondition", "last-owner")
})
test("ISOLATION: an owner of organisation X has no authority over organisation A in any function", async () => {
  await rejects(mem.setMemberRole(req("xowner", { organisationId: "orgA", userId: "emp", role: "content_manager" })), "permission-denied")
  await rejects(mem.removeOrganisationMember(req("xowner", { organisationId: "orgA", userId: "emp" })), "permission-denied")
  await rejects(invite("xowner", {}), "permission-denied")
  assert.equal(env.get("organisation-members/orgA_emp").role, "employee")
})
test("MULTIPLE ROLES: one user is owner in A and employee in X; authority is evaluated per organisation", async () => {
  addMember(env, "orgX", "owner", "employee") // 'owner' is an owner of A but only an employee of X
  await rejects(inv.inviteOrganisationMember(req("owner", { organisationId: "orgX", email: "z@example.com", role: "employee" })), "permission-denied")
  await inv.inviteOrganisationMember(req("owner", { organisationId: "orgA", email: "z@example.com", role: "employee" }))
})
test("a removed member and members of a suspended organisation lose all authority", async () => {
  await mem.removeOrganisationMember(req("owner", { organisationId: "orgA", userId: "mgr" }))
  await rejects(invite("mgr", {}), "permission-denied")
  env.db._write({ type: "update", path: "organisations/orgA", data: { approvalStatus: "suspended", active: false } })
  await rejects(invite("owner", {}), "failed-precondition", "organisation-inactive")
})
test("tampered membership documents cannot exceed the role's permissions", async () => {
  env.db._write({ type: "update", path: "organisation-members/orgA_emp", data: { permissions: ["members.manage", "bookings.read"] } })
  await rejects(invite("emp", {}), "permission-denied")
})

test("a membership document whose organisationId does not match its key is not honoured (defence in depth)", async () => {
  env.db._write({ type: "update", path: "organisation-members/orgA_owner", data: { organisationId: "orgX" } })
  await rejects(invite("owner", {}), "permission-denied")
})
