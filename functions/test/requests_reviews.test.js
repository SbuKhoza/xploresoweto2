"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setup, req, rejects, makeOrg, addMember } = require("./helpers")
const R = require("../src/handlers/requests")
const V = require("../src/handlers/reviews")

let env
beforeEach(() => {
  env = setup() // clock: 14 Nov 2026
  makeOrg(env, "orgA"); makeOrg(env, "orgB"); makeOrg(env, "orgS", { approved: false })
  addMember(env, "orgA", "ownerA", "owner"); addMember(env, "orgA", "resA", "reservations_manager"); addMember(env, "orgA", "empA", "employee"); addMember(env, "orgA", "contentA", "content_manager")
  addMember(env, "orgB", "ownerB", "owner")
  env.seed("business/biz1", { name: "Biz One", organisationId: "orgA", isActive: true })
  env.seed("business/bizUnlinked", { name: "CMS only", isActive: true })
  env.seed("business/bizOff", { name: "Hidden", organisationId: "orgA", isActive: false })
  env.seed("business/bizSusp", { name: "Suspended org", organisationId: "orgS", isActive: true })
  env.seed("restaurants/rest1", { name: "Rest One", organisationId: "orgA", isActive: true })
  env.addUser("cust"); env.addUser("cust2")
})
const svc = (uid = "cust", data = {}, o) => R.createServiceRequest(req(uid, { requestId: "req-00000001", listingId: "biz1", message: "Please fix my gate", ...data }, o))
const bk = (uid = "cust", data = {}, o) => R.createBookingRequest(req(uid, { requestId: "req-00000001", listingCollection: "restaurants", listingId: "rest1", date: "2026-11-20", guests: 4, ...data }, o))
const upd = (uid, kind, id, action) => R.updateRequestStatus(req(uid, { kind, id, action }))

test("service request: needs a verified email; unlinked / inactive / suspended-organisation listings give a controlled error", async () => {
  await rejects(svc("cust", {}, { verified: false }), "failed-precondition", "email-not-verified")
  for (const id of ["bizUnlinked", "bizOff", "bizSusp", "missing"]) await rejects(svc("cust", { listingId: id }), "failed-precondition", "listing-not-bookable")
  assert.equal(env.list("service-requests").length, 0)
})
test("service request: created with server-derived identity; retry returns the same record; extra fields refused", async () => {
  env.seed("users/cust", { uid: "cust", displayName: "Customer One" })
  const r = await svc(); assert.equal(r.id, "cust_req-00000001"); assert.equal(r.duplicate, false)
  const d = env.get("service-requests/cust_req-00000001")
  assert.deepEqual([d.customerUid, d.customerName, d.customerEmail, d.organisationId, d.status, d.listingName], ["cust", "Customer One", "cust@example.com", "orgA", "pending", "Biz One"])
  assert.equal((await svc()).duplicate, true); assert.equal(env.list("service-requests").length, 1)
  await rejects(svc("cust", { requestId: "req-00000002", status: "completed" }), "invalid-argument")
  await rejects(svc("cust", { requestId: "req-00000002", customerUid: "cust2" }), "invalid-argument")
})
test("service request: capped at 10 pending per user", async () => {
  for (let i = 0; i < 10; i++) await svc("cust", { requestId: `req-0000000${i}` })
  await rejects(svc("cust", { requestId: "req-99999999" }), "resource-exhausted")
})
test("booking request: validation (past date, guests, unknown collection) and the happy path", async () => {
  await rejects(bk("cust", { date: "2026-11-13" }), "invalid-argument", "date-in-past")
  await rejects(bk("cust", { guests: 0 }), "invalid-argument"); await rejects(bk("cust", { guests: 2.5 }), "invalid-argument")
  await rejects(bk("cust", { listingCollection: "business" }), "invalid-argument")
  await rejects(bk("cust", { date: "2026-11-20", endDate: "2026-11-19" }), "invalid-argument")
  const r = await bk(); assert.equal(r.status, "pending")
  assert.equal(env.get("bookings/cust_req-00000001").organisationId, "orgA")
  assert.equal((await bk()).duplicate, true)
})
test("state machine: only the right party can perform each step; invalid transitions are refused; retries are safe", async () => {
  await svc(); const id = "cust_req-00000001"
  await rejects(upd("ownerB", "service", id, "accept"), "permission-denied") // another organisation's owner
  await rejects(upd("empA", "service", id, "accept"), "permission-denied") // employee has no enquiries.manage
  await rejects(upd("cust", "service", id, "accept"), "permission-denied") // customer cannot accept
  await rejects(upd("resA", "service", id, "complete"), "failed-precondition", "invalid-transition") // not accepted yet
  assert.equal((await upd("resA", "service", id, "accept")).status, "accepted")
  assert.equal((await upd("resA", "service", id, "accept")).changed, false)
  await rejects(upd("resA", "service", id, "decline"), "failed-precondition")
  assert.equal((await upd("ownerA", "service", id, "complete")).status, "completed_by_provider")
  await rejects(upd("cust2", "service", id, "confirmCompletion"), "not-found") // someone else's request looks nonexistent
  assert.equal((await upd("cust", "service", id, "confirmCompletion")).status, "completed")
  await rejects(upd("cust", "service", id, "cancel"), "failed-precondition")
})
test("a provider can NEVER confirm completion on the customer's behalf", async () => {
  await svc(); const id = "cust_req-00000001"
  await upd("resA", "service", id, "accept"); await upd("resA", "service", id, "complete")
  await rejects(upd("ownerA", "service", id, "confirmCompletion"), "not-found")
  await rejects(upd("resA", "service", id, "confirmCompletion"), "not-found")
  assert.equal(env.get(`service-requests/${id}`).status, "completed_by_provider")
})
test("booking completion is refused before the booking date; customer can cancel pending/accepted", async () => {
  await bk(); const id = "cust_req-00000001"
  await upd("resA", "booking", id, "accept")
  await rejects(upd("resA", "booking", id, "complete"), "failed-precondition", "booking-date-not-reached")
  env.time.now = Date.UTC(2026, 10, 21, 10, 0, 0)
  assert.equal((await upd("resA", "booking", id, "complete")).status, "completed_by_provider")
  await bk("cust", { requestId: "req-00000002", date: "2026-12-01" })
  assert.equal((await upd("cust", "booking", "cust_req-00000002", "cancel")).status, "cancelled")
})
test("suspended organisation: its members can no longer act on requests", async () => {
  await svc(); env.db._write({ type: "update", path: "organisations/orgA", data: { approvalStatus: "suspended", active: false } })
  await rejects(upd("resA", "service", "cust_req-00000001", "accept"), "failed-precondition", "organisation-inactive")
})
const complete = async (uid = "cust", id = "biz1") => {
  const rid = `req-${id.padEnd(8, "0")}`
  await svc(uid, { requestId: rid, listingId: id }); const doc = `${uid}_${rid}`
  await upd("resA", "service", doc, "accept"); await upd("resA", "service", doc, "complete"); await upd(uid, "service", doc, "confirmCompletion")
}
test("REVIEWS: no review without a completed request, whatever the client says (canReview is irrelevant)", async () => {
  env.seed("users/cust", { uid: "cust", displayName: "C", canReview: true })
  assert.deepEqual(await V.checkReviewEligibility(req("cust", { listingId: "biz1" })), { eligible: false, alreadyReviewed: false })
  await rejects(V.submitReview(req("cust", { listingId: "biz1", rating: 5, comment: "great" })), "failed-precondition", "not-eligible")
  assert.equal(env.list("reviews").length, 0)
})
test("REVIEWS: provider marking a service 'complete' alone does NOT unlock a review", async () => {
  await svc(); await upd("resA", "service", "cust_req-00000001", "accept"); await upd("resA", "service", "cust_req-00000001", "complete")
  assert.equal((await V.checkReviewEligibility(req("cust", { listingId: "biz1" }))).eligible, false)
  await rejects(V.submitReview(req("cust", { listingId: "biz1", rating: 5, comment: "x" })), "failed-precondition", "not-eligible")
})
test("REVIEWS: eligible after the customer confirms; one review per listing; aggregate updated; ISO createdAt kept for the existing UI", async () => {
  env.seed("users/cust", { uid: "cust", displayName: "Customer One" })
  await complete()
  assert.equal((await V.checkReviewEligibility(req("cust", { listingId: "biz1" }))).eligible, true)
  const r = await V.submitReview(req("cust", { listingId: "biz1", rating: 4, comment: "Good job", reviewerName: "Cust" }))
  assert.equal(r.duplicate, false)
  const d = env.get(`reviews/${r.id}`)
  assert.deepEqual([d.userId, d.businessId, d.rating, d.reviewerName, d.basis.type], ["cust", "biz1", 4, "Cust", "service-request"])
  assert.equal(typeof d.createdAt, "string"); assert.ok(!Number.isNaN(Date.parse(d.createdAt)))
  assert.deepEqual([env.get("business/biz1").rating, env.get("business/biz1").reviews, env.get("business/biz1").ratingSum], [4, 1, 4])
  assert.equal((await V.submitReview(req("cust", { listingId: "biz1", rating: 1, comment: "again" }))).duplicate, true)
  assert.equal(env.list("reviews").length, 1); assert.equal(env.get("business/biz1").reviews, 1)
  assert.equal((await V.checkReviewEligibility(req("cust", { listingId: "biz1" }))).alreadyReviewed, true)
  await complete("cust2"); await V.submitReview(req("cust2", { listingId: "biz1", rating: 5, comment: "Excellent" }))
  assert.deepEqual([env.get("business/biz1").rating, env.get("business/biz1").reviews], [4.5, 2])
})
test("REVIEWS: someone else's completed request cannot be used; invalid ratings/comments and spoofed fields are refused", async () => {
  await complete("cust")
  await rejects(V.submitReview(req("cust2", { listingId: "biz1", rating: 5, comment: "x" })), "failed-precondition", "not-eligible")
  for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: "5" }, { comment: "" }, { comment: "x".repeat(1001) }, { userId: "cust2" }, { businessId: "other" }, { canReview: true }, { createdAt: "2000-01-01" }]) {
    await rejects(V.submitReview(req("cust", { listingId: "biz1", rating: 5, comment: "ok", ...bad })), "invalid-argument")
  }
  await rejects(V.submitReview(req("cust", { listingId: "biz1", rating: 5, comment: "ok" }, { verified: false })), "failed-precondition", "email-not-verified")
  assert.equal(env.list("reviews").length, 0)
})
test("REVIEWS: a completed request for listing A does not allow reviewing listing B", async () => {
  env.seed("business/biz2", { name: "Biz Two", organisationId: "orgA", isActive: true })
  await complete("cust", "biz1")
  await rejects(V.submitReview(req("cust", { listingId: "biz2", rating: 5, comment: "x" })), "failed-precondition", "not-eligible")
})
