"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setup, req, rejects, makeSuperAdmin, makeOrg, addMember } = require("./helpers")
const { submitProviderApplication, reviewProviderApplication } = require("../src/handlers/applications")
const { setOrganisationStatus } = require("../src/handlers/organisations")

let env, sa
beforeEach(() => { env = setup(); sa = makeSuperAdmin(env, "root"); env.addUser("alice"); env.addUser("bob") })

const application = (o = {}) => ({ requestId: "req-00000001", organisationType: "restaurant", organisationName: "Mama's Kitchen", description: "Home cooking", contact: { phone: "0110000000" }, documentPaths: [], ...o })

test("provider application: unverified email cannot submit; unauthenticated cannot submit", async () => {
  await rejects(submitProviderApplication(req("alice", application(), { verified: false })), "failed-precondition", "email-not-verified")
  await rejects(submitProviderApplication({ data: application() }), "unauthenticated")
  assert.equal(env.list("provider-applications").length, 0)
})
test("provider application: created with a deterministic id; a duplicate request returns the same record", async () => {
  const a = await submitProviderApplication(req("alice", application()))
  assert.equal(a.applicationId, "alice_req-00000001"); assert.equal(a.duplicate, false)
  const b = await submitProviderApplication(req("alice", application({ organisationName: "Changed Name" })))
  assert.equal(b.duplicate, true)
  assert.equal(env.list("provider-applications").length, 1)
  assert.equal(env.get("provider-applications/alice_req-00000001").organisationName, "Mama's Kitchen")
  assert.equal(env.get("provider-applications/alice_req-00000001").status, "submitted")
})
test("provider application: validation, forbidden fields, foreign document paths", async () => {
  await rejects(submitProviderApplication(req("alice", application({ status: "approved" }))), "invalid-argument")
  await rejects(submitProviderApplication(req("alice", application({ organisationType: "casino" }))), "invalid-argument")
  await rejects(submitProviderApplication(req("alice", application({ organisationName: "x" }))), "invalid-argument")
  await rejects(submitProviderApplication(req("alice", application({ documentPaths: ["provider-applications/bob/x/doc.pdf"] }))), "invalid-argument")
  await rejects(submitProviderApplication(req("alice", application({ documentPaths: ["provider-applications/alice/../bob/doc.pdf"] }))), "invalid-argument")
  const ok = await submitProviderApplication(req("alice", application({ documentPaths: ["provider-applications/alice/a1/reg.pdf"] })))
  assert.equal(ok.status, "submitted")
})
test("provider application: at most 3 open applications per user", async () => {
  for (let i = 1; i <= 3; i++) await submitProviderApplication(req("alice", application({ requestId: `req-0000000${i}` })))
  await rejects(submitProviderApplication(req("alice", application({ requestId: "req-00000009" }))), "resource-exhausted")
  await submitProviderApplication(req("bob", application({ requestId: "req-00000001" }))) // another user unaffected
})
test("review: applicants and ordinary users cannot approve (including their own)", async () => {
  await submitProviderApplication(req("alice", application()))
  await rejects(reviewProviderApplication(req("alice", { applicationId: "alice_req-00000001", decision: "approve" })), "permission-denied")
  await rejects(reviewProviderApplication(req("bob", { applicationId: "alice_req-00000001", decision: "approve" })), "permission-denied")
  assert.equal(env.list("organisations").length, 0)
})
test("review: a super admin cannot approve their OWN application", async () => {
  env.seed("provider-applications/root_req-1", { applicantUid: "root", organisationType: "business", organisationName: "Mine", status: "submitted", contact: {} })
  await rejects(reviewProviderApplication(sa({ applicationId: "root_req-1", decision: "approve" })), "permission-denied", "cannot-review-own-application")
})
test("review: approval creates exactly one organisation and one owner membership; repeating it creates no duplicates", async () => {
  await submitProviderApplication(req("alice", application()))
  const r1 = await reviewProviderApplication(sa({ applicationId: "alice_req-00000001", decision: "approve", note: "ok" }))
  assert.deepEqual([r1.status, r1.duplicate, r1.organisationId], ["approved", false, "alice_req-00000001"])
  const r2 = await reviewProviderApplication(sa({ applicationId: "alice_req-00000001", decision: "approve" }))
  assert.equal(r2.duplicate, true)
  const orgs = env.list("organisations"), members = env.list("organisation-members")
  assert.equal(orgs.length, 1); assert.equal(members.length, 1)
  assert.deepEqual([orgs[0].ownerUid, orgs[0].approvalStatus, orgs[0].active, orgs[0].verificationStatus], ["alice", "approved", true, "verified"])
  assert.deepEqual([members[0].id, members[0].role, members[0].active], ["alice_req-00000001_alice", "owner", true])
  assert.ok(members[0].permissions.includes("members.manage"))
  assert.equal(env.list("audit-log").filter((a) => a.action === "provider.approve").length, 1)
  assert.equal(env.get("provider-applications/alice_req-00000001").status, "approved")
})
test("review: reject, then approving a rejected application is refused", async () => {
  await submitProviderApplication(req("alice", application()))
  assert.equal((await reviewProviderApplication(sa({ applicationId: "alice_req-00000001", decision: "reject", note: "incomplete" }))).status, "rejected")
  await rejects(reviewProviderApplication(sa({ applicationId: "alice_req-00000001", decision: "approve" })), "failed-precondition")
  assert.equal(env.list("organisations").length, 0)
  assert.equal(env.list("audit-log").filter((a) => a.action === "provider.reject").length, 1)
})
test("review: concurrent approvals still create exactly one organisation", async () => {
  await submitProviderApplication(req("alice", application()))
  await Promise.all(Array.from({ length: 4 }, () => reviewProviderApplication(sa({ applicationId: "alice_req-00000001", decision: "approve" }))))
  assert.equal(env.list("organisations").length, 1); assert.equal(env.list("organisation-members").length, 1)
  assert.equal(env.list("audit-log").filter((a) => a.action === "provider.approve").length, 1)
})
test("review: a user can be a visitor AND own several organisations", async () => {
  await submitProviderApplication(req("alice", application({ requestId: "req-00000001" })))
  await submitProviderApplication(req("alice", application({ requestId: "req-00000002", organisationType: "accommodation", organisationName: "Guest House" })))
  await reviewProviderApplication(sa({ applicationId: "alice_req-00000001", decision: "approve" }))
  await reviewProviderApplication(sa({ applicationId: "alice_req-00000002", decision: "approve" }))
  assert.equal(env.list("organisation-members").filter((m) => m.userId === "alice" && m.role === "owner").length, 2)
})
test("setOrganisationStatus: super admin only; reason required; suspends and restores listings it hid", async () => {
  makeOrg(env, "orgA"); makeOrg(env, "orgB")
  env.seed("restaurants/r1", { name: "R1", organisationId: "orgA", isActive: true })
  env.seed("restaurants/r2", { name: "R2", organisationId: "orgA", isActive: false }) // staff-deactivated earlier
  env.seed("business/b1", { name: "B1", organisationId: "orgB", isActive: true })
  await rejects(setOrganisationStatus(req("alice", { organisationId: "orgA", status: "suspended", reason: "x" })), "permission-denied")
  await rejects(setOrganisationStatus(sa({ organisationId: "orgA", status: "suspended" })), "invalid-argument")
  const s = await setOrganisationStatus(sa({ organisationId: "orgA", status: "suspended", reason: "Complaint upheld" }))
  assert.deepEqual([s.changed, s.listingsUpdated], [true, 1])
  assert.deepEqual([env.get("organisations/orgA").approvalStatus, env.get("organisations/orgA").active], ["suspended", false])
  assert.equal(env.get("restaurants/r1").isActive, false); assert.equal(env.get("business/b1").isActive, true) // other org untouched
  const again = await setOrganisationStatus(sa({ organisationId: "orgA", status: "suspended", reason: "Complaint upheld" }))
  assert.equal(again.changed, false)
  await setOrganisationStatus(sa({ organisationId: "orgA", status: "approved" }))
  assert.equal(env.get("restaurants/r1").isActive, true)
  assert.equal(env.get("restaurants/r2").isActive, false) // NOT re-activated: it was not hidden by the suspension
  assert.ok(!("suspendedByOrganisation" in env.get("restaurants/r1")))
  assert.deepEqual(env.list("audit-log").map((a) => a.action).sort(), ["organisation.restore", "organisation.suspend"])
})
