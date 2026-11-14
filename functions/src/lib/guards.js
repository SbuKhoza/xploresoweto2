"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("./firebase")
const { COL, ROLE_PERMISSIONS } = require("./constants")

const denied = (m = "Not allowed") => new HttpsError("permission-denied", m)
const direct = { get: (ref) => ref.get() } // reader for non-transactional reads; a Transaction works the same way

async function requireAuth(request) {
  if (!request || !request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Sign in required")
  const token = request.auth.token || {}
  return { uid: request.auth.uid, token, email: typeof token.email === "string" ? token.email.toLowerCase() : null }
}
function requireVerified(ctx) {
  if (ctx.token.email_verified !== true) throw new HttpsError("failed-precondition", "email-not-verified")
  return ctx
}

// A custom claim alone NEVER grants access: the claim, a verified email AND an active authoritative record are all required.
async function hasActiveRecord(collection, uid, role) {
  const s = await fb.db().collection(collection).doc(uid).get()
  if (!s.exists) return false
  const d = s.data()
  return d.active === true && d.role === role && d.uid === uid
}
async function requireActiveSuperAdmin(request) {
  const ctx = await requireAuth(request)
  if (ctx.token.superAdmin !== true) throw denied()
  if (!(await hasActiveRecord(COL.superAdmin, ctx.uid, "super_admin"))) throw denied()
  requireVerified(ctx)
  return ctx
}
async function requireActiveStaff(request) {
  const ctx = await requireAuth(request)
  const claimsSuper = ctx.token.superAdmin === true
  const claimsEditor = ctx.token.editor === true
  if (!claimsSuper && !claimsEditor) throw denied()
  const ok = (claimsSuper && (await hasActiveRecord(COL.superAdmin, ctx.uid, "super_admin"))) ||
             (claimsEditor && (await hasActiveRecord(COL.editors, ctx.uid, "editor")))
  if (!ok) throw denied()
  requireVerified(ctx)
  return ctx
}

const orgRef = (id) => fb.db().collection(COL.orgs).doc(id)
const memberRef = (orgId, uid) => fb.db().collection(COL.members).doc(`${orgId}_${uid}`)
const effectivePermissions = (m) => {
  const allowed = ROLE_PERMISSIONS[m.role] || []
  return (Array.isArray(m.permissions) ? m.permissions : []).filter((p) => allowed.includes(p)) // defence against tampered docs
}
// Membership + permission + organisation state. Non-members always get a generic denial (no existence leak).
async function requireOrgPermission(reader, uid, orgId, perm, { allowInactiveOrg = false } = {}) {
  const mSnap = await reader.get(memberRef(orgId, uid))
  if (!mSnap.exists) throw denied()
  const membership = mSnap.data()
  if (membership.active !== true || membership.organisationId !== orgId || membership.userId !== uid) throw denied()
  if (perm && !effectivePermissions(membership).includes(perm)) throw denied()
  const oSnap = await reader.get(orgRef(orgId))
  if (!oSnap.exists) throw denied()
  const org = oSnap.data()
  if (!allowInactiveOrg && !(org.approvalStatus === "approved" && org.active === true)) throw new HttpsError("failed-precondition", "organisation-inactive")
  return { org, membership }
}

module.exports = { denied, direct, requireAuth, requireVerified, requireActiveSuperAdmin, requireActiveStaff, requireOrgPermission, effectivePermissions, orgRef, memberRef, hasActiveRecord }
