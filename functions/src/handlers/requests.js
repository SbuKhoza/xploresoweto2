"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const { COL, BOOKABLE_COLLECTIONS, SERVICE_COLLECTIONS, LIMITS } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const clock = require("../lib/clock")

const colFor = (kind) => (kind === "booking" ? COL.bookings : COL.serviceRequests)
const notBookable = () => new HttpsError("failed-precondition", "listing-not-bookable")

// Booking requests and service requests: the customer asks, the provider accepts or declines. Only listings that are active AND
// linked to an active, approved organisation can receive requests; anything else gets a controlled "not available" error.
async function createRequest(kind, request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  const rid = V.requestId(d.requestId)
  const listingId = V.docId(d.listingId, "listingId")
  let listingCollection, extra
  if (kind === "booking") {
    V.onlyKeys(d, ["requestId", "listingCollection", "listingId", "date", "endDate", "time", "guests", "notes", "phone"])
    listingCollection = V.oneOf(d.listingCollection, "listingCollection", BOOKABLE_COLLECTIONS)
    const date = V.ymd(d.date, "date")
    if (date < clock.todaySAST()) throw V.bad("date-in-past")
    const endDate = d.endDate === undefined ? undefined : V.ymd(d.endDate, "endDate")
    if (endDate && endDate < date) throw V.bad("endDate must not be before date")
    const time = d.time === undefined ? undefined : V.str(d.time, "time", { min: 5, max: 5 })
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw V.bad("Invalid time")
    extra = { date, endDate: endDate || null, time: time || null, guests: V.intRange(d.guests, "guests", 1, 50), notes: V.optStr(d.notes, "notes", { max: 500 }) || null, phone: V.optPhone(d.phone) || null }
  } else {
    V.onlyKeys(d, ["requestId", "listingCollection", "listingId", "message", "phone"])
    listingCollection = V.oneOf(d.listingCollection ?? "business", "listingCollection", SERVICE_COLLECTIONS)
    extra = { message: V.optStr(d.message, "message", { max: 1000 }) || null, phone: V.optPhone(d.phone) || null }
  }
  const col = colFor(kind)
  const id = `${ctx.uid}_${rid}`
  const ref = fb.db().collection(col).doc(id)
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) return { id, status: snap.data().status, duplicate: true } // safe retry
    const lSnap = await tx.get(fb.db().collection(listingCollection).doc(listingId))
    const listing = lSnap.exists ? lSnap.data() : null
    if (!listing || listing.isActive !== true || typeof listing.organisationId !== "string") throw notBookable()
    const oSnap = await tx.get(G.orgRef(listing.organisationId))
    if (!oSnap.exists || oSnap.data().approvalStatus !== "approved" || oSnap.data().active !== true) throw notBookable()
    const pending = await tx.get(fb.db().collection(col).where("customerUid", "==", ctx.uid).where("status", "==", "pending"))
    if (pending.size >= LIMITS.MAX_PENDING_REQUESTS_PER_USER) throw new HttpsError("resource-exhausted", "too-many-pending-requests")
    const uSnap = await tx.get(fb.db().collection(COL.users).doc(ctx.uid))
    tx.set(ref, {
      customerUid: ctx.uid, customerName: uSnap.exists ? uSnap.data().displayName || null : null, customerEmail: ctx.email,
      organisationId: listing.organisationId, listingCollection, listingId, listingName: listing.name || listing.title || "",
      ...extra, status: "pending", createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
    })
    return { id, status: "pending", duplicate: false }
  })
}
const createBookingRequest = (request) => createRequest("booking", request)
const createServiceRequest = (request) => createRequest("service", request)

// State machine (both kinds):
//   pending --accept/decline--> accepted/declined            (provider)
//   accepted --complete--> completed_by_provider              (provider)
//   completed_by_provider --confirmCompletion--> completed    (CUSTOMER)   <- only "completed" can unlock a review
//   pending|accepted --cancel--> cancelled                    (customer)
// A provider can therefore never unlock a review on its own: the customer has to confirm the service happened.
const TRANSITIONS = {
  accept: { from: ["pending"], to: "accepted", by: "provider" },
  decline: { from: ["pending"], to: "declined", by: "provider" },
  complete: { from: ["accepted"], to: "completed_by_provider", by: "provider" },
  confirmCompletion: { from: ["completed_by_provider"], to: "completed", by: "customer" },
  cancel: { from: ["pending", "accepted"], to: "cancelled", by: "customer" },
}
async function updateRequestStatus(request) {
  const ctx = await G.requireAuth(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["kind", "id", "action"])
  const kind = V.oneOf(d.kind, "kind", ["booking", "service"])
  const id = V.docId(d.id, "id")
  const action = V.oneOf(d.action, "action", Object.keys(TRANSITIONS))
  const t = TRANSITIONS[action]
  const ref = fb.db().collection(colFor(kind)).doc(id)
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError("not-found", "request-not-found")
    const doc = snap.data()
    if (t.by === "customer") {
      if (doc.customerUid !== ctx.uid) throw new HttpsError("not-found", "request-not-found")
    } else {
      await G.requireOrgPermission(tx, ctx.uid, doc.organisationId, kind === "booking" ? "bookings.manage" : "enquiries.manage")
    }
    if (doc.status === t.to) return { id, status: doc.status, changed: false } // safe retry
    if (!t.from.includes(doc.status)) throw new HttpsError("failed-precondition", "invalid-transition")
    if (action === "complete" && kind === "booking" && (doc.endDate || doc.date) > clock.todaySAST()) throw new HttpsError("failed-precondition", "booking-date-not-reached")
    const ts = FV.serverTimestamp()
    const patch = { status: t.to, updatedAt: ts }
    if (action === "accept" || action === "decline") Object.assign(patch, { respondedBy: ctx.uid, respondedAt: ts })
    if (action === "complete") Object.assign(patch, { providerCompletedBy: ctx.uid, providerCompletedAt: ts })
    if (action === "confirmCompletion") patch.customerConfirmedAt = ts
    if (action === "cancel") patch.cancelledAt = ts
    tx.update(ref, patch)
    return { id, status: t.to, changed: true }
  })
}
module.exports = { createBookingRequest, createServiceRequest, updateRequestStatus, TRANSITIONS }
