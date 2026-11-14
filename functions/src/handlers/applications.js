"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const { COL, ORG_TYPES, LIMITS } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")
const { permissionsForRole } = require("../lib/org")

async function submitProviderApplication(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["requestId", "organisationType", "organisationName", "description", "contact", "documentPaths"])
  const rid = V.requestId(d.requestId)
  const type = V.oneOf(d.organisationType, "organisationType", ORG_TYPES)
  const name = V.str(d.organisationName, "organisationName", { min: 2, max: 120 })
  const description = V.optStr(d.description, "description", { max: 2000 }) || ""
  const c = V.object(d.contact, "contact")
  V.onlyKeys(c, ["phone", "email", "address", "website"], "contact")
  const contact = {}
  if (c.phone !== undefined) contact.phone = V.optPhone(c.phone, "contact.phone")
  if (c.email !== undefined) contact.email = V.email(c.email, "contact.email")
  if (c.address !== undefined) contact.address = V.optStr(c.address, "contact.address", { max: 300 })
  if (c.website !== undefined) contact.website = V.optStr(c.website, "contact.website", { max: 200 })
  Object.keys(contact).forEach((k) => contact[k] === undefined && delete contact[k])
  const documentPaths = V.storagePaths(d.documentPaths, "documentPaths", `provider-applications/${ctx.uid}/`, LIMITS.MAX_DOCUMENT_PATHS)

  const applicationId = `${ctx.uid}_${rid}`
  const ref = fb.db().collection(COL.applications).doc(applicationId)
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) return { applicationId, status: snap.data().status, duplicate: true } // safe retry
    const open = await tx.get(fb.db().collection(COL.applications).where("applicantUid", "==", ctx.uid).where("status", "==", "submitted"))
    if (open.size >= LIMITS.MAX_OPEN_APPLICATIONS) throw new HttpsError("resource-exhausted", "too-many-open-applications")
    tx.set(ref, {
      applicantUid: ctx.uid, organisationType: type, organisationName: name, description, contact, documentPaths,
      status: "submitted", createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
    })
    return { applicationId, status: "submitted", duplicate: false }
  })
}

async function reviewProviderApplication(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["applicationId", "decision", "note"])
  const applicationId = V.docId(d.applicationId, "applicationId")
  const decision = V.oneOf(d.decision, "decision", ["approve", "reject"])
  const note = V.optStr(d.note, "note", { max: 1000 }) || null

  const appRef = fb.db().collection(COL.applications).doc(applicationId)
  const pre = await appRef.get()
  if (!pre.exists) throw new HttpsError("not-found", "Application not found")
  const applicantUid = pre.data().applicantUid
  if (applicantUid === actor.uid) throw new HttpsError("permission-denied", "cannot-review-own-application")
  if (decision === "approve") {
    try { await fb.auth().getUser(applicantUid) } catch { throw new HttpsError("failed-precondition", "applicant-account-missing") }
  }

  const FV = fb.FieldValue()
  const orgRef = fb.db().collection(COL.orgs).doc(applicationId) // deterministic: one application -> at most one organisation
  const memRef = fb.db().collection(COL.members).doc(`${applicationId}_${applicantUid}`)
  const userRef = fb.db().collection(COL.users).doc(applicantUid)
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(appRef)
    const app = snap.data()
    if (decision === "approve" && app.status === "approved") return { status: "approved", organisationId: app.organisationId, duplicate: true }
    if (decision === "reject" && app.status === "rejected") return { status: "rejected", duplicate: true }
    if (app.status !== "submitted") throw new HttpsError("failed-precondition", `application-${app.status}`)
    if (!ORG_TYPES.includes(app.organisationType)) throw new HttpsError("failed-precondition", "invalid-organisation-type")

    if (decision === "reject") {
      tx.update(appRef, { status: "rejected", reviewedBy: actor.uid, reviewedAt: FV.serverTimestamp(), reviewNote: note, updatedAt: FV.serverTimestamp() })
      writeAudit(tx, { action: "provider.reject", actorUid: actor.uid, targetUid: applicantUid, details: { applicationId } })
      return { status: "rejected", duplicate: false }
    }
    const [orgSnap, userSnap] = await Promise.all([tx.get(orgRef), tx.get(userRef)])
    if (orgSnap.exists) throw new HttpsError("already-exists", "organisation-exists")
    const displayName = userSnap.exists ? userSnap.data().displayName || null : null
    const now = FV.serverTimestamp()
    tx.set(orgRef, {
      name: app.organisationName, organisationType: app.organisationType, description: app.description || "", ownerUid: applicantUid,
      verificationStatus: "verified", approvalStatus: "approved", active: true, contact: app.contact || {}, applicationId, createdAt: now, updatedAt: now,
    })
    tx.set(memRef, {
      organisationId: applicationId, userId: applicantUid, displayName, role: "owner", permissions: permissionsForRole("owner"),
      active: true, status: "active", invitedBy: null, createdAt: now, updatedAt: now,
    })
    tx.update(appRef, { status: "approved", organisationId: applicationId, reviewedBy: actor.uid, reviewedAt: now, reviewNote: note, updatedAt: now })
    writeAudit(tx, { action: "provider.approve", actorUid: actor.uid, targetUid: applicantUid, organisationId: applicationId, details: { applicationId, organisationType: app.organisationType } })
    return { status: "approved", organisationId: applicationId, duplicate: false }
  })
}
module.exports = { submitProviderApplication, reviewProviderApplication }
