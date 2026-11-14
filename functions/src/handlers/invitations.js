"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const { COL, ORG_ROLES, MANAGER_ASSIGNABLE_ROLES, LIMITS } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const clock = require("../lib/clock")
const { writeAudit } = require("../lib/audit")
const { sha256hex, newToken, safeEqualHex } = require("../lib/crypto")
const { permissionsForRole, isExpired } = require("../lib/org")

// Invitation document ids are a hash of (organisation, email): no email appears in any path, and clients cannot read
// this collection at all (rules deny it); they go through these functions, which mask emails.
const invitationId = (orgId, email) => sha256hex(`${orgId}|${email}`)
const invCol = () => fb.db().collection(COL.invitations)
const notFound = () => new HttpsError("not-found", "invalid-invitation") // identical for missing / wrong email / wrong token

async function inviteOrganisationMember(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["organisationId", "email", "role"])
  const orgId = V.docId(d.organisationId, "organisationId")
  const inviteEmail = V.email(d.email)
  const role = V.oneOf(d.role, "role", ORG_ROLES)
  if (inviteEmail === ctx.email) throw V.bad("You cannot invite yourself")

  let existingUid = null
  try { existingUid = (await fb.auth().getUserByEmail(inviteEmail)).uid } catch (e) { if (!e || e.code !== "auth/user-not-found") throw e }

  const id = invitationId(orgId, inviteEmail)
  const ref = invCol().doc(id)
  const token = newToken()
  const FV = fb.FieldValue()
  const expires = fb.Timestamp().fromMillis(clock.now().getTime() + LIMITS.INVITE_TTL_DAYS * 86400000)

  await fb.db().runTransaction(async (tx) => {
    const { org, membership } = await G.requireOrgPermission(tx, ctx.uid, orgId, "members.manage")
    if (membership.role !== "owner" && !MANAGER_ASSIGNABLE_ROLES.includes(role)) throw new HttpsError("permission-denied", "role-not-assignable")
    if (existingUid) {
      const m = await tx.get(G.memberRef(orgId, existingUid))
      if (m.exists && m.data().active === true) throw new HttpsError("already-exists", "already-member")
    }
    const snap = await tx.get(ref)
    const pendingNow = snap.exists && snap.data().status === "pending"
    if (!pendingNow) {
      const q = await tx.get(invCol().where("organisationId", "==", orgId).where("status", "==", "pending"))
      if (q.docs.filter((s) => !isExpired(s.data().expiresAt)).length >= LIMITS.MAX_PENDING_INVITES_PER_ORG) throw new HttpsError("resource-exhausted", "too-many-pending-invitations")
    }
    const base = {
      organisationId: orgId, organisationName: org.name, email: inviteEmail, role, permissions: permissionsForRole(role),
      tokenHash: sha256hex(token), status: "pending", expiresAt: expires, invitedBy: ctx.uid, updatedAt: FV.serverTimestamp(),
    }
    tx.set(ref, { ...base, createdAt: snap.exists ? snap.data().createdAt : FV.serverTimestamp() }) // re-inviting refreshes token + expiry
    writeAudit(tx, { action: "organisation.invitation.create", actorUid: ctx.uid, organisationId: orgId, details: { role, invitationId: id } })
  })
  // The raw token is returned ONCE to the inviter; only its SHA-256 hash is stored.
  return { invitationId: id, token, expiresAt: expires.toMillis() }
}

async function listOrganisationInvitations(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["organisationId"])
  const orgId = V.docId(d.organisationId, "organisationId")
  await G.requireOrgPermission(G.direct, ctx.uid, orgId, "members.manage")
  const snap = await invCol().where("organisationId", "==", orgId).get()
  const invitations = snap.docs.slice(0, 200).map((s) => {
    const x = s.data()
    const status = x.status === "pending" && isExpired(x.expiresAt) ? "expired" : x.status
    return { invitationId: s.id, email: V.maskEmail(x.email), role: x.role, status, expiresAt: x.expiresAt.toMillis() }
  })
  return { invitations }
}

async function revokeOrganisationInvitation(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["organisationId", "invitationId"])
  const orgId = V.docId(d.organisationId, "organisationId")
  const ref = invCol().doc(V.docId(d.invitationId, "invitationId"))
  const FV = fb.FieldValue()
  const changed = await fb.db().runTransaction(async (tx) => {
    const { membership } = await G.requireOrgPermission(tx, ctx.uid, orgId, "members.manage")
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data().organisationId !== orgId) throw new HttpsError("not-found", "invitation-not-found")
    const inv = snap.data()
    if (membership.role !== "owner" && !MANAGER_ASSIGNABLE_ROLES.includes(inv.role)) throw new HttpsError("permission-denied", "role-not-assignable")
    if (inv.status === "revoked") return false
    if (inv.status !== "pending") throw new HttpsError("failed-precondition", `invitation-${inv.status}`)
    tx.update(ref, { status: "revoked", revokedBy: ctx.uid, revokedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })
    writeAudit(tx, { action: "organisation.invitation.revoke", actorUid: ctx.uid, organisationId: orgId, details: { role: inv.role, invitationId: ref.id } })
    return true
  })
  return { ok: true, changed }
}

async function listMyInvitations(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const snap = await invCol().where("email", "==", ctx.email).where("status", "==", "pending").get()
  const invitations = snap.docs.filter((s) => !isExpired(s.data().expiresAt)).map((s) => {
    const x = s.data()
    return { invitationId: s.id, organisationId: x.organisationId, organisationName: x.organisationName, role: x.role, expiresAt: x.expiresAt.toMillis() }
  })
  return { invitations }
}

// Acceptance requires a VERIFIED email that equals the invited email. Authorisation is either the invitationId shown in-app to
// that email's owner, or the single-use token. The membership is created here, never by the client.
async function acceptOrganisationInvitation(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["invitationId", "token"])
  if (d.invitationId === undefined && d.token === undefined) throw V.bad("invitationId or token is required")
  let ref
  let token
  if (d.token !== undefined) {
    token = V.str(d.token, "token", { min: 20, max: 100 })
    const q = await invCol().where("tokenHash", "==", sha256hex(token)).limit(1).get()
    if (q.empty) throw notFound()
    ref = q.docs[0].ref
    if (d.invitationId !== undefined && V.docId(d.invitationId, "invitationId") !== ref.id) throw notFound()
  } else {
    ref = invCol().doc(V.docId(d.invitationId, "invitationId"))
  }
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw notFound()
    const inv = snap.data()
    if (inv.email !== ctx.email) throw notFound()
    if (token !== undefined && !safeEqualHex(sha256hex(token), inv.tokenHash)) throw notFound()
    const mRef = G.memberRef(inv.organisationId, ctx.uid)
    const [mSnap, oSnap, uSnap] = await Promise.all([tx.get(mRef), tx.get(G.orgRef(inv.organisationId)), tx.get(fb.db().collection(COL.users).doc(ctx.uid))])
    if (inv.status === "accepted") {
      if (mSnap.exists && mSnap.data().active === true && mSnap.data().invitationId === ref.id) return { alreadyMember: true, organisationId: inv.organisationId } // safe retry
      throw new HttpsError("failed-precondition", "invitation-used")
    }
    if (inv.status !== "pending") throw new HttpsError("failed-precondition", `invitation-${inv.status}`)
    if (isExpired(inv.expiresAt)) throw new HttpsError("failed-precondition", "invitation-expired")
    if (!oSnap.exists || oSnap.data().approvalStatus !== "approved" || oSnap.data().active !== true) throw new HttpsError("failed-precondition", "organisation-inactive")
    const now = FV.serverTimestamp()
    if (mSnap.exists && mSnap.data().active === true) { // already a member through another path: consume the invitation, change nothing else
      tx.update(ref, { status: "accepted", acceptedBy: ctx.uid, acceptedAt: now, updatedAt: now })
      return { alreadyMember: true, organisationId: inv.organisationId }
    }
    const base = {
      organisationId: inv.organisationId, userId: ctx.uid, displayName: uSnap.exists ? uSnap.data().displayName || null : null,
      role: inv.role, permissions: permissionsForRole(inv.role), active: true, status: "active", invitedBy: inv.invitedBy, invitationId: ref.id, updatedAt: now,
    }
    if (mSnap.exists) tx.update(mRef, { ...base, removedBy: FV.delete(), removedAt: FV.delete() })
    else tx.set(mRef, { ...base, createdAt: now })
    tx.update(ref, { status: "accepted", acceptedBy: ctx.uid, acceptedAt: now, updatedAt: now })
    writeAudit(tx, { action: "organisation.member.add", actorUid: ctx.uid, targetUid: ctx.uid, organisationId: inv.organisationId, details: { role: inv.role, invitationId: ref.id } })
    return { alreadyMember: false, organisationId: inv.organisationId, role: inv.role }
  })
}

async function declineOrganisationInvitation(request) {
  const ctx = G.requireVerified(await G.requireAuth(request))
  const d = V.object(request.data)
  V.onlyKeys(d, ["invitationId"])
  const ref = invCol().doc(V.docId(d.invitationId, "invitationId"))
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data().email !== ctx.email) throw notFound()
    const inv = snap.data()
    if (inv.status === "declined") return { ok: true, changed: false }
    if (inv.status !== "pending") throw new HttpsError("failed-precondition", `invitation-${inv.status}`)
    tx.update(ref, { status: "declined", declinedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })
    writeAudit(tx, { action: "organisation.invitation.decline", actorUid: ctx.uid, organisationId: inv.organisationId, details: { invitationId: ref.id } })
    return { ok: true, changed: true }
  })
}
module.exports = { inviteOrganisationMember, listOrganisationInvitations, revokeOrganisationInvitation, listMyInvitations, acceptOrganisationInvitation, declineOrganisationInvitation, invitationId }
