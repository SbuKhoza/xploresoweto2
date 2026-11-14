"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const { COL, LISTING_TARGETS, LIMITS } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")

const TEXT_FIELDS = { name: 120, type: 60, category: 60, description: 2000, location: 300, address: 300, phone: 20, email: 254, website: 200, openingHours: 300, hours: 300, price: 60, priceRange: 60, cuisine: 100 }
const LIST_FIELDS = ["tags", "features", "amenities", "specialDishes"]
const ALLOWED_PAYLOAD = [...Object.keys(TEXT_FIELDS), ...LIST_FIELDS, "coordinates"]

function validatePayload(p) {
  const o = V.object(p, "payload")
  V.onlyKeys(o, ALLOWED_PAYLOAD, "payload")
  const out = {}
  for (const [k, max] of Object.entries(TEXT_FIELDS)) if (o[k] !== undefined) out[k] = V.str(o[k], k, { min: 1, max })
  for (const k of LIST_FIELDS) {
    if (o[k] === undefined) continue
    if (!Array.isArray(o[k]) || o[k].length > 30) throw V.bad(`${k} must be a short list`)
    out[k] = o[k].map((x) => V.str(x, k, { max: 100 }))
  }
  if (o.coordinates !== undefined) {
    const c = V.object(o.coordinates, "coordinates")
    V.onlyKeys(c, ["latitude", "longitude"], "coordinates")
    if (typeof c.latitude !== "number" || typeof c.longitude !== "number" || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) throw V.bad("Invalid coordinates")
    out.coordinates = { latitude: c.latitude, longitude: c.longitude }
  }
  return out
}

async function submitListing(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["requestId", "organisationId", "kind", "targetDocId", "payload", "imagePaths"])
  const rid = V.requestId(d.requestId)
  const orgId = V.docId(d.organisationId, "organisationId")
  const kind = V.oneOf(d.kind, "kind", ["new", "change"])
  const targetDocId = kind === "change" ? V.docId(d.targetDocId, "targetDocId") : null
  const payload = validatePayload(d.payload)
  if (kind === "new" && !payload.name) throw V.bad("A new listing needs a name")
  const submissionId = `${orgId}_${rid}`
  const imagePaths = V.storagePaths(d.imagePaths, "imagePaths", `listing-submissions/${orgId}/${submissionId}/`, LIMITS.MAX_IMAGE_PATHS)
  const ref = fb.db().collection(COL.submissions).doc(submissionId)
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const { org } = await G.requireOrgPermission(tx, ctx.uid, orgId, "content.manage")
    const targetCollection = LISTING_TARGETS[org.organisationType]
    if (!targetCollection) throw new HttpsError("failed-precondition", "listing-type-not-supported-yet") // tour packages are a later stage
    const snap = await tx.get(ref)
    if (snap.exists) return { submissionId, status: snap.data().status, duplicate: true }
    const pending = await tx.get(fb.db().collection(COL.submissions).where("organisationId", "==", orgId).where("status", "==", "pending"))
    if (pending.size >= LIMITS.MAX_PENDING_SUBMISSIONS_PER_ORG) throw new HttpsError("resource-exhausted", "too-many-pending-submissions")
    tx.set(ref, { organisationId: orgId, kind, targetCollection, targetDocId, payload, imagePaths, status: "pending", submittedBy: ctx.uid, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })
    return { submissionId, status: "pending", duplicate: false }
  })
}

// Staff (active super admin or editor) approve or reject. Approval publishes into the existing public collection with
// organisationId + isActive:true, which is what makes the listing visible to the app's (isActive-filtered) queries.
async function reviewListingSubmission(request) {
  const staff = await G.requireActiveStaff(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["submissionId", "decision", "note"])
  const id = V.docId(d.submissionId, "submissionId")
  const decision = V.oneOf(d.decision, "decision", ["approve", "reject"])
  const note = V.optStr(d.note, "note", { max: 1000 }) || null
  const ref = fb.db().collection(COL.submissions).doc(id)
  const pre = await ref.get()
  if (!pre.exists) throw new HttpsError("not-found", "submission-not-found")
  const FV = fb.FieldValue()

  let imageUrls = []
  if (decision === "approve" && pre.data().status === "pending") {
    const s = pre.data()
    const bucket = fb.bucket()
    const docId = s.kind === "new" ? id : s.targetDocId
    // Copy submitted images to the public folder (idempotent: deterministic destinations). The public URL needs no token because
    // public folders are world-readable under the Storage rules.
    for (const p of s.imagePaths || []) {
      const dest = `${s.targetCollection}/${s.organisationId}/${docId}/${p.split("/").pop()}`
      await bucket.file(p).copy(bucket.file(dest))
      imageUrls.push(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media`)
    }
  }
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const s = snap.data()
    if (decision === "approve" && s.status === "approved") return { status: "approved", publishedDocId: s.publishedDocId, duplicate: true }
    if (decision === "reject" && s.status === "rejected") return { status: "rejected", duplicate: true }
    if (s.status !== "pending") throw new HttpsError("failed-precondition", `submission-${s.status}`)
    if (decision === "reject") {
      tx.update(ref, { status: "rejected", reviewedBy: staff.uid, reviewedAt: FV.serverTimestamp(), reviewNote: note, updatedAt: FV.serverTimestamp() })
      writeAudit(tx, { action: "listing.reject", actorUid: staff.uid, organisationId: s.organisationId, details: { submissionId: id } })
      return { status: "rejected", duplicate: false }
    }
    const docId = s.kind === "new" ? id : s.targetDocId
    const targetRef = fb.db().collection(s.targetCollection).doc(docId)
    const [tSnap, oSnap] = await Promise.all([tx.get(targetRef), tx.get(G.orgRef(s.organisationId))])
    if (!oSnap.exists || oSnap.data().approvalStatus !== "approved" || oSnap.data().active !== true) throw new HttpsError("failed-precondition", "organisation-inactive")
    const now = FV.serverTimestamp()
    if (s.kind === "new") {
      if (tSnap.exists) throw new HttpsError("already-exists", "listing-exists")
      tx.set(targetRef, { ...s.payload, images: imageUrls, organisationId: s.organisationId, isActive: true, submissionId: id, publishedBy: staff.uid, createdAt: now, updatedAt: now })
    } else {
      if (!tSnap.exists || tSnap.data().organisationId !== s.organisationId) throw new HttpsError("failed-precondition", "target-not-owned-by-organisation")
      const patch = { ...s.payload, updatedAt: now }
      if (imageUrls.length) patch.images = imageUrls
      tx.update(targetRef, patch)
    }
    tx.update(ref, { status: "approved", publishedDocId: docId, reviewedBy: staff.uid, reviewedAt: now, reviewNote: note, updatedAt: now })
    writeAudit(tx, { action: "listing.publish", actorUid: staff.uid, organisationId: s.organisationId, details: { submissionId: id, targetCollection: s.targetCollection, docId } })
    return { status: "approved", publishedDocId: docId, duplicate: false }
  })
}
module.exports = { submitListing, reviewListingSubmission }
