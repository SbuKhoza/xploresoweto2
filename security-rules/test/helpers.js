"use strict"
const fs = require("fs")
const path = require("path")
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing")
const { doc, setDoc } = require("firebase/firestore")

const makeEnv = () => initializeTestEnvironment({
  projectId: "demo-xploresoweto",
  firestore: { rules: fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  storage: { rules: fs.readFileSync(path.join(__dirname, "../storage.rules"), "utf8"), host: "127.0.0.1", port: 9199 },
})
const PERMS = {
  owner: ["profile.edit", "content.manage", "bookings.read", "bookings.manage", "enquiries.manage", "members.manage"],
  manager: ["profile.edit", "content.manage", "bookings.read", "bookings.manage", "enquiries.manage", "members.manage"],
  reservations_manager: ["bookings.read", "bookings.manage", "enquiries.manage"],
  content_manager: ["profile.edit", "content.manage"],
  employee: ["bookings.read"],
}
// Baseline data (written with rules disabled, standing in for what Cloud Functions / the console create)
async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore(); const put = (p, d) => setDoc(doc(db, p), d)
    await put("super-admin/root", { uid: "root", email: "root@x.com", role: "super_admin", active: true })
    await put("super-admin/exSA", { uid: "exSA", email: "ex@x.com", role: "super_admin", active: false })
    await put("platform-editors/ed", { uid: "ed", role: "editor", active: true })
    await put("platform-editors/exEd", { uid: "exEd", role: "editor", active: false })
    await put("users/alice", { uid: "alice", email: "alice@x.com", displayName: "Alice", enrolled: false })
    await put("users/bob", { uid: "bob", email: "bob@x.com", displayName: "Bob" })
    for (const [id, ok] of [["orgA", true], ["orgB", true], ["orgC", false]]) await put(`organisations/${id}`, { name: id, organisationType: "restaurant", ownerUid: "owner" + id, approvalStatus: ok ? "approved" : "suspended", active: ok, verificationStatus: "verified", description: "", contact: {} })
    for (const [org, uid, role] of [["orgA", "ownerA", "owner"], ["orgA", "mgrA", "manager"], ["orgA", "resA", "reservations_manager"], ["orgA", "contentA", "content_manager"], ["orgA", "empA", "employee"], ["orgB", "ownerB", "owner"], ["orgC", "ownerC", "owner"]])
      await put(`organisation-members/${org}_${uid}`, { organisationId: org, userId: uid, role, permissions: PERMS[role], active: true })
    await put("restaurants/r1", { name: "Active", isActive: true }); await put("restaurants/r2", { name: "Inactive", isActive: false }); await put("restaurants/r3", { name: "NoFlag" })
    await put("events/e1", { title: "Event", isActive: true }); await put("homescreen/h1", { type: "hero", isActive: true }); await put("xplore-menu/m1", { screen: "Restaurants", isActive: true }); await put("loadshedding/orlando", { suburb: "Orlando", isActive: true })
    await put("provider-applications/alice_r1", { applicantUid: "alice", status: "submitted" })
    await put("organisation-invitations/inv1", { organisationId: "orgA", email: "n@x.com", status: "pending", tokenHash: "h" })
    await put("listing-submissions/orgA_s1", { organisationId: "orgA", status: "pending" })
    await put("bookings/alice_b1", { customerUid: "alice", organisationId: "orgA", status: "pending" })
    await put("service-requests/alice_s1", { customerUid: "alice", organisationId: "orgA", status: "pending" })
    await put("reviews/alice_business_b1", { userId: "alice", rating: 5 })
    await put("audit-log/a1", { action: "x", actorUid: "root" })
    await put("Person-Of-Interest/p1", { name: "N" }); await put("admin/x", { a: 1 }); await put("userservices/u1", { userId: "alice" })
  })
}
const as = (env, uid, claims = {}, verified = true) => env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: verified, ...claims })
module.exports = { makeEnv, seed, as }
