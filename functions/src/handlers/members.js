"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const { COL, ORG_ROLES, MANAGER_ASSIGNABLE_ROLES } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")
const { permissionsForRole } = require("../lib/org")

const activeOwners = (tx, orgId) =>
  tx.get(fb.db().collection(COL.members).where("organisationId", "==", orgId).where("role", "==", "owner").where("active", "==", true))

// Role changes. Owners may set any role; everyone else may only touch staff-level roles, never their own, and never create
// owners/managers. The last owner can never be demoted. All permission sets are resolved server-side.
async function setMemberRole(request) {
  const ctx = await G.requireAuth(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["organisationId", "userId", "role"])
  const orgId = V.docId(d.organisationId, "organisationId")
  const userId = V.docId(d.userId, "userId")
  const role = V.oneOf(d.role, "role", ORG_ROLES)
  const FV = fb.FieldValue()
  const changed = await fb.db().runTransaction(async (tx) => {
    const { membership: actor } = await G.requireOrgPermission(tx, ctx.uid, orgId, "members.manage")
    if (userId === ctx.uid) throw new HttpsError("failed-precondition", "cannot-change-own-role")
    const tSnap = await tx.get(G.memberRef(orgId, userId))
    if (!tSnap.exists || tSnap.data().active !== true) throw new HttpsError("not-found", "member-not-found")
    const target = tSnap.data()
    if (actor.role !== "owner" && (!MANAGER_ASSIGNABLE_ROLES.includes(target.role) || !MANAGER_ASSIGNABLE_ROLES.includes(role))) throw new HttpsError("permission-denied", "role-not-assignable")
    if (target.role === role) return false
    if (target.role === "owner") {
      const owners = await activeOwners(tx, orgId)
      if (owners.size <= 1) throw new HttpsError("failed-precondition", "last-owner")
    }
    tx.update(tSnap.ref, { role, permissions: permissionsForRole(role), updatedAt: FV.serverTimestamp() })
    writeAudit(tx, { action: "organisation.member.role", actorUid: ctx.uid, targetUid: userId, organisationId: orgId, details: { from: target.role, to: role } })
    return true
  })
  return { ok: true, changed }
}

// Removal (or leaving: a member may always remove themselves unless they are the last owner).
async function removeOrganisationMember(request) {
  const ctx = await G.requireAuth(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["organisationId", "userId"])
  const orgId = V.docId(d.organisationId, "organisationId")
  const userId = V.docId(d.userId, "userId")
  const FV = fb.FieldValue()
  const changed = await fb.db().runTransaction(async (tx) => {
    const self = userId === ctx.uid
    let actor = null
    if (!self) ({ membership: actor } = await G.requireOrgPermission(tx, ctx.uid, orgId, "members.manage"))
    const tSnap = await tx.get(G.memberRef(orgId, userId))
    if (!tSnap.exists || tSnap.data().active !== true) {
      if (self) throw G.denied()
      return false // already removed: idempotent
    }
    const target = tSnap.data()
    if (!self && actor.role !== "owner" && !MANAGER_ASSIGNABLE_ROLES.includes(target.role)) throw new HttpsError("permission-denied", "role-not-assignable")
    if (target.role === "owner") {
      const owners = await activeOwners(tx, orgId)
      if (owners.size <= 1) throw new HttpsError("failed-precondition", "last-owner")
    }
    tx.update(tSnap.ref, { active: false, status: "removed", removedBy: ctx.uid, removedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })
    writeAudit(tx, { action: "organisation.member.remove", actorUid: ctx.uid, targetUid: userId, organisationId: orgId, details: { role: target.role, self } })
    return true
  })
  return { ok: true, changed }
}
module.exports = { setMemberRole, removeOrganisationMember }
