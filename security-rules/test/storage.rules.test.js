"use strict"
const { assertFails, assertSucceeds } = require("@firebase/rules-unit-testing")
const { ref, uploadBytes, deleteObject } = require("firebase/storage")
const { makeEnv, seed, as } = require("./helpers")

const bytes = (n = 100) => new Uint8Array(n)
const png = { contentType: "image/png" }, pdf = { contentType: "application/pdf" }

describe("Storage rules (Stage 1, proposed)", () => {
  let env
  before(async () => { env = await makeEnv() })
  after(async () => { await env.cleanup() })
  beforeEach(async () => { await env.clearFirestore(); await env.clearStorage(); await seed(env) })
  const st = (uid, claims, verified) => (uid ? as(env, uid, claims, verified).storage() : env.unauthenticatedContext().storage())
  const put = (s, path, data = bytes(), meta = png) => uploadBytes(ref(s, path), data, meta)
  const SA = { superAdmin: true }, ED = { editor: true }

  it("unauthenticated users cannot upload or delete anywhere", async () => {
    for (const p of ["news/a.png", "profile-images/alice", "restaurants/orgA/a.png", "listing-submissions/orgA/orgA_s1/a.png", "random/a.png"]) await assertFails(put(st(), p))
  })
  it("profile images: owner only, image types, 2 MB cap, owner-only read", async () => {
    await assertSucceeds(put(st("alice"), "profile-images/alice"))
    await assertSucceeds(uploadBytes(ref(st("alice"), "profile-images/alice"), bytes(), { contentType: "image/jpeg" }))
    await assertFails(put(st("bob"), "profile-images/alice")); await assertFails(put(st("alice"), "profile-images/alice", bytes(), { contentType: "text/html" }))
    await assertFails(put(st("alice"), "profile-images/alice", bytes(3 * 1024 * 1024))); await assertFails(deleteObject(ref(st("bob"), "profile-images/alice")))
    await assertFails(put(st("root", SA), "profile-images/alice")) // not even staff
  })
  it("published media: public read of the right folders; only ACTIVE staff write", async () => {
    await assertSucceeds(put(st("ed", ED), "news/n1.png")); await assertSucceeds(put(st("root", SA), "events/e1.png"))
    await assertFails(put(st("alice"), "news/n1.png")); await assertFails(put(st("ed", ED), "news/n1.exe", bytes(), { contentType: "application/x-msdownload" })); await assertFails(put(st("ed", ED), "news/big.png", bytes(6 * 1024 * 1024)))
    await assertFails(put(st("ghost", ED), "news/n2.png")); await assertFails(put(st("exEd", ED), "news/n2.png")); await assertFails(put(st("ed", {}), "news/n2.png")); await assertFails(put(st("ed", ED, false), "news/n2.png"))
    await assertFails(deleteObject(ref(st("alice"), "news/n1.png"))); await assertFails(put(st("ed", ED), "secret-folder/x.png"))
  })
  it("provider listing submissions: content-managing members of an approved organisation only", async () => {
    const p = "listing-submissions/orgA/orgA_req1/front.png"
    await assertSucceeds(put(st("ownerA"), p)); await assertSucceeds(put(st("contentA"), "listing-submissions/orgA/orgA_req2/front.png"))
    await assertFails(put(st("empA"), p + "2")); await assertFails(put(st("resA"), p + "3")); await assertFails(put(st("ownerB"), p + "4")); await assertFails(put(st("bob"), p + "5"))
    await assertFails(put(st("ownerC"), "listing-submissions/orgC/orgC_req1/a.png")) // suspended organisation
    await assertFails(put(st("ownerA"), "listing-submissions/orgA/wrongprefix/a.png")); await assertFails(put(st("ownerA"), p, bytes(), pdf))
    await assertFails(put(st("ownerA"), p)) // immutable: no overwrite
    await assertFails(deleteObject(ref(st("ownerA"), p)))
  })
  it("provider application documents are private to the applicant and super admins, and immutable", async () => {
    const p = "provider-applications/alice/alice_r1/registration.pdf"
    await assertSucceeds(put(st("alice"), p, bytes(), pdf)); await assertFails(put(st("bob"), "provider-applications/alice/alice_r2/x.pdf", bytes(), pdf))
    await assertFails(put(st("alice", {}, false), "provider-applications/alice/alice_r3/x.pdf", bytes(), pdf)) // unverified
    await assertFails(put(st("alice"), "provider-applications/alice/bad-prefix/x.pdf", bytes(), pdf)); await assertFails(put(st("alice"), "provider-applications/alice/alice_r4/x.exe", bytes(), { contentType: "application/octet-stream" }))
    await assertFails(put(st("alice"), p, bytes(), pdf)); await assertFails(deleteObject(ref(st("alice"), p)))
    await assertSucceeds(uploadBytes(ref(st("alice"), "provider-applications/alice/alice_r5/ok.png"), bytes(), png))
  })
  it("person-of-interest uploads are closed (feature excluded from launch)", async () => {
    await assertFails(put(st("alice"), "person-of-interest/alice/p.png")); await assertFails(put(st("alice"), "person-of-interest/p.png")); await assertFails(put(st("root", SA), "person-of-interest/p.png"))
  })
})
