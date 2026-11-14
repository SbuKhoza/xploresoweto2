"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const { COL } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")

const LISTING_COLLECTIONS = ["restaurants", "accommodations", "business"]

// Hides (or restores) the organisation's published listings. Only listings hidden BY the suspension are restored, so a listing
// that staff deactivated for another reason is never silently re-activated. Idempotent, safe to repeat.
async function toggleListings(orgId, suspend) {
  const FV = fb.FieldValue()
  let updated = 0
  for (const name of LISTING_COLLECTIONS) {
    const snap = await fb.db().collection(name).where("organisationId", "==", orgId).get()
    const docs = snap.docs.filter((s) => (suspend ? s.data().isActive === true : s.data().suspendedByOrganisation === true))
    for (let i = 0; i < docs.length; i += 400) {
      const batch = fb.db().batch()
      docs.slice(i, i + 400).forEach((s) => batch.update(s.ref, suspend ? { isActive: false, suspendedByOrganisation: true } : { isActive: true, suspendedByOrganisation: FV.delete() }))
      await batch.commit()
    }
    updated += docs.length
  }
  return updated
}

async function setOrganisationStatus(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["organisationId", "status", "reason"])
  const orgId = V.docId(d.organisationId, "organisationId")
  const status = V.oneOf(d.status, "status", ["approved", "suspended"])
  const reason = V.optStr(d.reason, "reason", { max: 500 })
  if (status === "suspended" && !reason) throw V.bad("A reason is required to suspend an organisation")
  const ref = G.orgRef(orgId)
  const FV = fb.FieldValue()
  const changed = await fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError("not-found", "Organisation not found")
    if (snap.data().approvalStatus === status) return false
    tx.update(ref, {
      approvalStatus: status, active: status === "approved", updatedAt: FV.serverTimestamp(),
      suspension: status === "suspended" ? { reason, by: actor.uid, at: FV.serverTimestamp() } : FV.delete(),
    })
    writeAudit(tx, { action: status === "suspended" ? "organisation.suspend" : "organisation.restore", actorUid: actor.uid, organisationId: orgId, details: { reason: reason || null } })
    return true
  })
  const listingsUpdated = await toggleListings(orgId, status === "suspended") // also repairs an interrupted earlier attempt
  return { ok: true, changed, listingsUpdated }
}
module.exports = { setOrganisationStatus }
