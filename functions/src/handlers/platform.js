"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")
const platform = require("../lib/platform")

// Only an ACTIVE super admin (claim + verified email + active record) may change platform roles.
// The first super admin is created manually in Firestore and activated with scripts/super-admin.js.
async function managePlatformRole(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["action", "role", "uid"])
  const action = V.oneOf(d.action, "action", ["add", "remove"])
  const roleKey = V.oneOf(d.role, "role", ["superAdmin", "editor"])
  const target = V.docId(d.uid, "uid")
  const kind = platform.KINDS[roleKey]
  const ref = fb.db().collection(kind.col).doc(target)
  const FV = fb.FieldValue()
  let changed

  if (action === "add") {
    let user
    try { user = await fb.auth().getUser(target) } catch (e) {
      if (e && e.code === "auth/user-not-found") throw new HttpsError("not-found", "No such account")
      throw e
    }
    if (!user.email) throw new HttpsError("failed-precondition", "account-has-no-email")
    if (!user.emailVerified) throw new HttpsError("failed-precondition", "target-email-not-verified")
    changed = await fb.db().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists && snap.data().active === true && snap.data().role === kind.role) return false
      const base = { uid: target, email: user.email.toLowerCase(), displayName: user.displayName || null, role: kind.role, active: true, grantedBy: actor.uid, updatedAt: FV.serverTimestamp() }
      if (snap.exists) tx.update(ref, { ...base, revokedBy: FV.delete() })
      else tx.set(ref, { ...base, createdAt: FV.serverTimestamp() })
      writeAudit(tx, { action: `platform.${roleKey}.add`, actorUid: actor.uid, targetUid: target })
      return true
    })
  } else {
    if (roleKey === "superAdmin" && target === actor.uid) throw new HttpsError("failed-precondition", "cannot-remove-self")
    changed = await fb.db().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists || snap.data().active !== true) return false
      if (roleKey === "superAdmin") {
        const active = await tx.get(fb.db().collection(kind.col).where("active", "==", true))
        if (active.size <= 1) throw new HttpsError("failed-precondition", "last-super-admin")
      }
      tx.update(ref, { active: false, revokedBy: actor.uid, updatedAt: FV.serverTimestamp() })
      writeAudit(tx, { action: `platform.${roleKey}.remove`, actorUid: actor.uid, targetUid: target })
      return true
    })
  }
  // Always (re)align the derived claim with the authoritative record; this also repairs an interrupted earlier attempt.
  const sync = await platform.syncClaim(roleKey, target)
  return { ok: true, changed, claimChanged: sync.changed }
}
module.exports = { managePlatformRole }
