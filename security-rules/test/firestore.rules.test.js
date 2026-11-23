"use strict"
const { assertFails, assertSucceeds } = require("@firebase/rules-unit-testing")
const { doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where } = require("firebase/firestore")
const { makeEnv, seed, as } = require("./helpers")

describe("Firestore rules (Stage 1, proposed)", () => {
  let env
  before(async () => { env = await makeEnv() })
  after(async () => { await env.cleanup() })
  beforeEach(async () => { await env.clearFirestore(); await seed(env); })
  const anon = () => env.unauthenticatedContext().firestore()
  const as_ = (uid, claims, verified) => as(env, uid, claims, verified).firestore()
  const SA = { superAdmin: true }, ED = { editor: true }

  describe("public content: the app's real queries", () => {
    it("unauthenticated users can read an active document", () => assertSucceeds(getDoc(doc(anon(), "restaurants/r1"))))
    it("the app's filtered list query (where isActive == true) works", () => assertSucceeds(getDocs(query(collection(anon(), "restaurants"), where("isActive", "==", true)))))
    for (const c of ["accommodations", "attractions", "business", "restaurants", "recreation", "events", "news", "announcements", "transport", "healthcare", "emergency", "publicservice", "homescreen", "xplore-menu", "loadshedding"]) {
      it(`filtered list works for ${c}`, () => assertSucceeds(getDocs(query(collection(as_("alice"), c), where("isActive", "==", true)))))
    }
    it("an UNFILTERED list query is rejected (rules are not filters)", () => assertFails(getDocs(collection(anon(), "restaurants"))))
    it("inactive and flag-less documents are not readable", async () => {
      await assertFails(getDoc(doc(anon(), "restaurants/r2"))); await assertFails(getDoc(doc(anon(), "restaurants/r3")))
      await assertFails(getDocs(query(collection(anon(), "restaurants"), where("isActive", "==", false))))
    })
    it("ordinary users and anonymous visitors cannot write content", async () => {
      await assertFails(updateDoc(doc(anon(), "restaurants/r1"), { name: "x" }))
      await assertFails(setDoc(doc(as_("alice"), "restaurants/new"), { name: "x", isActive: true }))
      await assertFails(deleteDoc(doc(as_("alice"), "restaurants/r1")))
    })
    it("collections outside the public list are closed", async () => {
      for (const p of ["Person-Of-Interest/p1", "admin/x", "userservices/u1", "unknown/x"]) await assertFails(getDoc(doc(as_("alice"), p)))
    })
  })

  describe("platform staff: a claim alone grants nothing", () => {
    it("active editor (claim + verified + record) can write content", () => assertSucceeds(updateDoc(doc(as_("ed", ED), "restaurants/r1"), { name: "Renamed" })))
    it("active super admin can write content and read super-admin/audit", async () => {
      await assertSucceeds(updateDoc(doc(as_("root", SA), "restaurants/r1"), { name: "Renamed" }))
      await assertSucceeds(getDoc(doc(as_("root", SA), "super-admin/root"))); await assertSucceeds(getDoc(doc(as_("root", SA), "audit-log/a1")))
    })
    it("claim WITHOUT a record is denied", async () => {
      await assertFails(updateDoc(doc(as_("ghost", SA), "restaurants/r1"), { name: "x" }))
      await assertFails(getDoc(doc(as_("ghost", SA), "super-admin/root")))
      await assertFails(updateDoc(doc(as_("ghost", ED), "restaurants/r1"), { name: "x" }))
    })
    it("inactive record is denied even with the claim", async () => {
      await assertFails(getDoc(doc(as_("exSA", SA), "super-admin/root")))
      await assertFails(updateDoc(doc(as_("exEd", ED), "restaurants/r1"), { name: "x" }))
    })
    it("active record WITHOUT the claim is denied", async () => {
      await assertFails(getDoc(doc(as_("root", {}), "super-admin/root")))
      await assertFails(updateDoc(doc(as_("ed", {}), "restaurants/r1"), { name: "x" }))
    })
    it("an unverified email is denied", async () => {
      await assertFails(getDoc(doc(as_("root", SA, false), "super-admin/root")))
      await assertFails(updateDoc(doc(as_("ed", ED, false), "restaurants/r1"), { name: "x" }))
    })
    it("nobody can write super-admin, platform-editors or audit-log from a client (even a super admin)", async () => {
      for (const ctx of [as_("alice"), as_("root", SA), as_("ed", ED)]) {
        await assertFails(setDoc(doc(ctx, "super-admin/alice"), { uid: "alice", role: "super_admin", active: true }))
        await assertFails(updateDoc(doc(ctx, "super-admin/root"), { active: false }))
        await assertFails(setDoc(doc(ctx, "platform-editors/alice"), { uid: "alice", role: "editor", active: true }))
        await assertFails(addDoc(collection(ctx, "audit-log"), { action: "fake" }))
      }
    })
    it("editors cannot read user profiles, applications or super-admin records", async () => {
      await assertFails(getDoc(doc(as_("ed", ED), "users/alice"))); await assertFails(getDoc(doc(as_("ed", ED), "provider-applications/alice_r1"))); await assertFails(getDoc(doc(as_("ed", ED), "super-admin/root")))
    })
  })

  describe("users", () => {
    it("a user reads only their own profile; nobody can list profiles", async () => {
      await assertSucceeds(getDoc(doc(as_("alice"), "users/alice"))); await assertFails(getDoc(doc(as_("alice"), "users/bob")))
      await assertFails(getDocs(collection(as_("alice"), "users"))); await assertFails(getDocs(query(collection(as_("root", SA), "users"), where("email", "==", "bob@x.com"))))
    })
    it("a user can update permitted fields (as the app's enrollment and profile screens do)", async () => {
      await assertSucceeds(updateDoc(doc(as_("alice"), "users/alice"), { displayName: "Alice B", greeting: "Sawubona", kasi: "Orlando", phone: "0110000000", city: "Soweto", enrolled: true, enrolledAt: new Date(), updatedAt: new Date() }))
    })
    it("a user can NEVER change privileged or identity fields", async () => {
      const db = as_("alice")
      for (const patch of [{ email: "evil@x.com" }, { uid: "bob" }, { role: "super_admin" }, { roles: ["x"] }, { permissions: ["members.manage"] }, { superAdmin: true }, { isAdmin: true }, { canReview: true }, { organisationId: "orgA" }, { verified: true }, { createdAt: new Date() }])
        await assertFails(updateDoc(doc(db, "users/alice"), patch))
    })
    it("field validation, no create, no delete, no editing others", async () => {
      await assertFails(updateDoc(doc(as_("alice"), "users/alice"), { displayName: "" }))
      await assertFails(updateDoc(doc(as_("alice"), "users/alice"), { displayName: "x".repeat(61) }))
      await assertFails(updateDoc(doc(as_("alice"), "users/alice"), { enrolled: "yes" }))
      await assertFails(setDoc(doc(as_("newuser"), "users/newuser"), { uid: "newuser", displayName: "N" }))
      await assertFails(deleteDoc(doc(as_("alice"), "users/alice")))
      await assertFails(updateDoc(doc(as_("alice"), "users/bob"), { displayName: "hacked" }))
    })
  })

  describe("provider applications", () => {
    it("the applicant reads their own (query filtered by applicantUid); others cannot", async () => {
      await assertSucceeds(getDocs(query(collection(as_("alice"), "provider-applications"), where("applicantUid", "==", "alice"))))
      await assertFails(getDoc(doc(as_("bob"), "provider-applications/alice_r1"))); await assertFails(getDocs(collection(as_("bob"), "provider-applications")))
      await assertSucceeds(getDoc(doc(as_("root", SA), "provider-applications/alice_r1")))
    })
    it("clients cannot create, approve or edit applications", async () => {
      await assertFails(addDoc(collection(as_("bob"), "provider-applications"), { applicantUid: "bob", status: "submitted" }))
      await assertFails(updateDoc(doc(as_("alice"), "provider-applications/alice_r1"), { status: "approved" }))
      await assertFails(updateDoc(doc(as_("root", SA), "provider-applications/alice_r1"), { status: "approved" }))
    })
  })

  describe("organisations: isolation", () => {
    it("members read their own organisation; outsiders and other organisations' owners cannot", async () => {
      await assertSucceeds(getDoc(doc(as_("ownerA"), "organisations/orgA"))); await assertSucceeds(getDoc(doc(as_("empA"), "organisations/orgA")))
      await assertFails(getDoc(doc(as_("bob"), "organisations/orgA"))); await assertFails(getDoc(doc(as_("ownerB"), "organisations/orgA")))
      await assertFails(getDocs(collection(as_("ownerA"), "organisations")))
    })
    it("clients cannot create or delete organisations", async () => {
      await assertFails(setDoc(doc(as_("alice"), "organisations/mine"), { name: "x", ownerUid: "alice", approvalStatus: "approved", active: true }))
      await assertFails(deleteDoc(doc(as_("ownerA"), "organisations/orgA")))
    })
    it("owner, manager and content manager can edit organisation information; employee and reservations manager cannot", async () => {
      for (const uid of ["ownerA", "mgrA", "contentA"]) await assertSucceeds(updateDoc(doc(as_(uid), "organisations/orgA"), { description: "Updated", contact: { phone: "0110000000" }, updatedAt: new Date() }))
      for (const uid of ["empA", "resA"]) await assertFails(updateDoc(doc(as_(uid), "organisations/orgA"), { description: "x" }))
    })
    it("protected organisation fields cannot be changed by members", async () => {
      for (const patch of [{ name: "New" }, { ownerUid: "alice" }, { approvalStatus: "suspended" }, { active: false }, { verificationStatus: "unverified" }, { organisationType: "business" }])
        await assertFails(updateDoc(doc(as_("ownerA"), "organisations/orgA"), patch))
    })
    it("a member of one organisation cannot touch another, and a suspended organisation cannot be edited", async () => {
      await assertFails(updateDoc(doc(as_("ownerA"), "organisations/orgB"), { description: "x" }))
      await assertFails(updateDoc(doc(as_("ownerC"), "organisations/orgC"), { description: "x" }))
    })
  })

  describe("organisation memberships and invitations", () => {
    it("a user lists their own memberships; managers list their organisation's members", async () => {
      await assertSucceeds(getDocs(query(collection(as_("ownerA"), "organisation-members"), where("userId", "==", "ownerA"))))
      await assertSucceeds(getDocs(query(collection(as_("mgrA"), "organisation-members"), where("organisationId", "==", "orgA"))))
    })
    it("employees, other organisations and outsiders cannot list another organisation's members", async () => {
      await assertFails(getDocs(query(collection(as_("empA"), "organisation-members"), where("organisationId", "==", "orgA"))))
      await assertFails(getDocs(query(collection(as_("ownerB"), "organisation-members"), where("organisationId", "==", "orgA"))))
      await assertFails(getDocs(query(collection(as_("bob"), "organisation-members"), where("organisationId", "==", "orgA"))))
    })
    it("memberships can never be written by clients (no self-promotion)", async () => {
      await assertFails(setDoc(doc(as_("bob"), "organisation-members/orgA_bob"), { organisationId: "orgA", userId: "bob", role: "owner", active: true, permissions: ["members.manage"] }))
      await assertFails(updateDoc(doc(as_("mgrA"), "organisation-members/orgA_empA"), { role: "owner" }))
      await assertFails(updateDoc(doc(as_("empA"), "organisation-members/orgA_empA"), { permissions: ["members.manage"] }))
      await assertFails(updateDoc(doc(as_("root", SA), "organisation-members/orgA_empA"), { role: "owner" }))
    })
    it("invitations are invisible and unwritable for every client, including super admins", async () => {
      for (const ctx of [as_("ownerA"), as_("root", SA), as_("alice")]) {
        await assertFails(getDoc(doc(ctx, "organisation-invitations/inv1"))); await assertFails(getDocs(collection(ctx, "organisation-invitations")))
        await assertFails(setDoc(doc(ctx, "organisation-invitations/x"), { email: "a@x.com" })); await assertFails(updateDoc(doc(ctx, "organisation-invitations/inv1"), { status: "accepted" }))
      }
    })
  })

  describe("listing submissions", () => {
    it("content-managing members and staff read; employees, other organisations and outsiders cannot", async () => {
      await assertSucceeds(getDocs(query(collection(as_("contentA"), "listing-submissions"), where("organisationId", "==", "orgA"))))
      await assertSucceeds(getDocs(collection(as_("ed", ED), "listing-submissions")))
      await assertFails(getDocs(query(collection(as_("empA"), "listing-submissions"), where("organisationId", "==", "orgA"))))
      await assertFails(getDocs(query(collection(as_("ownerB"), "listing-submissions"), where("organisationId", "==", "orgA"))))
    })
    it("clients cannot write submissions (submitListing does)", async () => {
      await assertFails(addDoc(collection(as_("contentA"), "listing-submissions"), { organisationId: "orgA", status: "approved" }))
      await assertFails(updateDoc(doc(as_("ed", ED), "listing-submissions/orgA_s1"), { status: "approved" }))
    })
  })

  describe("bookings and service requests: privacy", () => {
    it("the customer reads their own; other customers cannot", async () => {
      await assertSucceeds(getDocs(query(collection(as_("alice"), "bookings"), where("customerUid", "==", "alice"))))
      await assertFails(getDoc(doc(as_("bob"), "bookings/alice_b1"))); await assertFails(getDocs(collection(as_("bob"), "bookings")))
    })
    it("organisation members with bookings.read can read their organisation's bookings; others cannot", async () => {
      for (const uid of ["ownerA", "mgrA", "resA", "empA"]) await assertSucceeds(getDocs(query(collection(as_(uid), "bookings"), where("organisationId", "==", "orgA"))))
      await assertFails(getDocs(query(collection(as_("contentA"), "bookings"), where("organisationId", "==", "orgA"))))
      await assertFails(getDocs(query(collection(as_("ownerB"), "bookings"), where("organisationId", "==", "orgA"))))
    })
    it("service requests need enquiries.manage (employees and content managers cannot read them)", async () => {
      for (const uid of ["ownerA", "mgrA", "resA"]) await assertSucceeds(getDocs(query(collection(as_(uid), "service-requests"), where("organisationId", "==", "orgA"))))
      for (const uid of ["empA", "contentA", "ownerB"]) await assertFails(getDocs(query(collection(as_(uid), "service-requests"), where("organisationId", "==", "orgA"))))
    })
    it("nobody can create or modify bookings/service requests from a client", async () => {
      for (const ctx of [as_("alice"), as_("ownerA"), as_("root", SA)]) {
        await assertFails(addDoc(collection(ctx, "bookings"), { customerUid: "alice", organisationId: "orgA", status: "pending" }))
        await assertFails(updateDoc(doc(ctx, "bookings/alice_b1"), { status: "completed" }))
        await assertFails(updateDoc(doc(ctx, "service-requests/alice_s1"), { status: "completed" }))
        await assertFails(deleteDoc(doc(ctx, "bookings/alice_b1")))
      }
    })
  })

  describe("reviews", () => {
    it("signed-in users can read reviews; anonymous cannot", async () => {
      await assertSucceeds(getDocs(query(collection(as_("bob"), "reviews"), where("userId", "==", "alice")))); await assertFails(getDocs(collection(anon(), "reviews")))
    })
    it("clients can never create, edit or delete reviews", async () => {
      for (const ctx of [as_("alice"), as_("root", SA)]) {
        await assertFails(addDoc(collection(ctx, "reviews"), { userId: "alice", rating: 5, comment: "x", businessId: "b1" }))
        await assertFails(updateDoc(doc(ctx, "reviews/alice_business_b1"), { rating: 1 })); await assertFails(deleteDoc(doc(ctx, "reviews/alice_business_b1")))
      }
    })
  })

  describe("AI assistant collections are server-only (Stage 2A)", () => {
    const paths = ["ai-conversations/c_1", "ai-conversations/c_1/messages/m1", "ai-usage/u_alice_2026-11-14", "ai-usage/g_2026-11", "ai-config/default"]
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore()
        for (const p of paths) await setDoc(doc(db, p), { ownerUid: "alice", text: "private", spentMicros: 1 })
      })
    })
    it("no client (owner, other user, anonymous, editor, super admin) can read any AI document", async () => {
      for (const ctx of [as_("alice"), as_("bob"), anon(), as_("ed", ED), as_("root", SA)]) for (const p of paths) await assertFails(getDoc(doc(ctx, p)))
    })
    it("no client can list AI collections, even filtered to their own uid", async () => {
      await assertFails(getDocs(query(collection(as_("alice"), "ai-conversations"), where("ownerUid", "==", "alice"))))
      await assertFails(getDocs(collection(as_("alice"), "ai-conversations/c_1/messages")))
      await assertFails(getDocs(collection(as_("root", SA), "ai-usage"))); await assertFails(getDocs(collection(as_("root", SA), "ai-config")))
    })
    it("no client can create, change or delete AI documents (usage limits and the budget cannot be tampered with)", async () => {
      for (const ctx of [as_("alice"), as_("root", SA), anon()]) for (const p of paths) {
        await assertFails(setDoc(doc(ctx, p), { ownerUid: "alice", requests: 0 })); await assertFails(updateDoc(doc(ctx, p), { requests: 0, spentMicros: 0 })); await assertFails(deleteDoc(doc(ctx, p)))
      }
    })
  })
})
