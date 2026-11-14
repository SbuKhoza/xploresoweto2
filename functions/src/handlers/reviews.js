"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const { COL, BOOKABLE_COLLECTIONS, SERVICE_COLLECTIONS } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const clock = require("../lib/clock")

const ALL_REVIEWABLE = [...SERVICE_COLLECTIONS, ...BOOKABLE_COLLECTIONS]
const basisCollection = (listingCollection) => (SERVICE_COLLECTIONS.includes(listingCollection) ? COL.serviceRequests : COL.bookings)
const basisType = (listingCollection) => (SERVICE_COLLECTIONS.includes(listingCollection) ? "service-request" : "booking")

// Eligibility is decided HERE from server-side records: the customer must hold a request for this listing that is "completed"
// (provider marked it done AND the customer confirmed). Nothing client-controlled (such as a canReview flag) is consulted.
async function findQualifying(reader, uid, listingCollection, listingId) {
  const q = fb.db().collection(basisCollection(listingCollection))
    .where("customerUid", "==", uid).where("listingId", "==", listingId).where("status", "==", "completed").limit(1)
  const snap = await reader.get(q)
  return snap.empty ? null : snap.docs[0]
}
const reviewId = (uid, listingCollection, listingId) => `${uid}_${listingCollection}_${listingId}`

async function checkReviewEligibility(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["listingCollection", "listingId"])
  const listingCollection = V.oneOf(d.listingCollection ?? "business", "listingCollection", ALL_REVIEWABLE)
  const listingId = V.docId(d.listingId, "listingId")
  const existing = await fb.db().collection(COL.reviews).doc(reviewId(ctx.uid, listingCollection, listingId)).get()
  if (existing.exists) return { eligible: false, alreadyReviewed: true }
  const basis = await findQualifying(G.direct, ctx.uid, listingCollection, listingId)
  return { eligible: !!basis, alreadyReviewed: false }
}

async function submitReview(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["listingCollection", "listingId", "rating", "comment", "reviewerName"])
  const listingCollection = V.oneOf(d.listingCollection ?? "business", "listingCollection", ALL_REVIEWABLE)
  const listingId = V.docId(d.listingId, "listingId")
  const rating = V.intRange(d.rating, "rating", 1, 5)
  const comment = V.str(d.comment, "comment", { max: 1000 })
  const reviewerName = V.optStr(d.reviewerName, "reviewerName", { max: 60 })
  const id = reviewId(ctx.uid, listingCollection, listingId)
  const ref = fb.db().collection(COL.reviews).doc(id)
  const listingRef = fb.db().collection(listingCollection).doc(listingId)
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) return { id, duplicate: true } // one review per customer per listing; retries are harmless
    const basis = await findQualifying(tx, ctx.uid, listingCollection, listingId)
    if (!basis) throw new HttpsError("failed-precondition", "not-eligible")
    const [lSnap, uSnap] = await Promise.all([tx.get(listingRef), tx.get(fb.db().collection(COL.users).doc(ctx.uid))])
    if (!lSnap.exists) throw new HttpsError("not-found", "listing-not-found")
    const l = lSnap.data()
    const count = (Number.isInteger(l.ratingCount) ? l.ratingCount : 0) + 1
    const sum = (typeof l.ratingSum === "number" ? l.ratingSum : 0) + rating
    // createdAt stays an ISO string because the existing review screen renders it with new Date(createdAt)
    tx.set(ref, {
      userId: ctx.uid, businessId: listingId, listingId, listingCollection, organisationId: l.organisationId || null, rating, comment,
      reviewerName: reviewerName || (uSnap.exists ? uSnap.data().displayName : null) || "Explorer",
      basis: { type: basisType(listingCollection), id: basis.id }, createdAt: clock.now().toISOString(), createdAtServer: FV.serverTimestamp(),
    })
    tx.update(listingRef, { ratingCount: count, ratingSum: sum, rating: Math.round((sum / count) * 10) / 10, reviews: count })
    return { id, duplicate: false }
  })
}
module.exports = { checkReviewEligibility, submitReview, reviewId }
