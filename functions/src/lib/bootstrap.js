"use strict"
// Logic behind scripts/super-admin.js, kept separate so it can be tested. It is deliberately READ-ONLY for the `super-admin`
// collection: it never creates, edits or deletes a super-admin record. The first record is created by hand in the Firebase
// console; this code only checks it and then derives the custom claim from it.
const fb = require("./firebase")
const { COL } = require("./constants")
const platform = require("./platform")
const { writeAudit } = require("./audit")

const OLD_PROJECT = "the-steady-hotel"
const fail = (m) => Object.assign(new Error(m), { bootstrap: true })

async function loadAuthUser(uid) {
  try { return await fb.auth().getUser(uid) } catch (e) {
    if (e && e.code === "auth/user-not-found") throw fail(`No Firebase Authentication account has UID "${uid}".`)
    throw e
  }
}
async function checkRecord(uid, user) {
  const snap = await fb.db().collection(COL.superAdmin).doc(uid).get()
  if (!snap.exists) throw fail(`No document super-admin/${uid} exists. Create it manually in the Firebase console first (see docs/stage1/SUPER_ADMIN_BOOTSTRAP.md).`)
  const r = snap.data()
  if (r.uid !== uid) throw fail(`super-admin/${uid}: field "uid" is "${r.uid}" but must equal the document id.`)
  if (r.role !== "super_admin") throw fail(`super-admin/${uid}: field "role" must be "super_admin" (found "${r.role}").`)
  if (r.active !== true) throw fail(`super-admin/${uid}: field "active" must be true (found ${JSON.stringify(r.active)}).`)
  if (typeof r.email !== "string" || r.email.toLowerCase() !== String(user.email || "").toLowerCase()) throw fail(`super-admin/${uid}: "email" does not match the Authentication account's email.`)
  if (user.disabled) throw fail("The Authentication account is disabled.")
  return r
}
async function otherActiveRecords(uid) {
  const q = await fb.db().collection(COL.superAdmin).where("active", "==", true).get()
  return q.docs.filter((d) => d.id !== uid).map((d) => d.id)
}

async function bootstrap({ uid, allowMultiple = false, confirm }) {
  if (!uid) throw fail("--uid is required. This tool never chooses an account for you.")
  const user = await loadAuthUser(uid)
  const record = await checkRecord(uid, user)
  const others = await otherActiveRecords(uid)
  if (others.length && !allowMultiple) throw fail(`Other active super-admin records exist (${others.join(", ")}). Refusing without --allow-multiple.`)
  if (confirm && !(await confirm(user))) throw fail("Not confirmed. Nothing was changed.")
  const result = await platform.syncClaim("superAdmin", uid)
  const after = await loadAuthUser(uid)
  const verified = after.customClaims && after.customClaims.superAdmin === true
  if (!verified) throw fail("The claim was not present after setting it. Investigate before continuing.")
  if (result.changed) {
    const batch = fb.db().batch()
    writeAudit(batch, { action: "platform.superAdmin.bootstrap", actorUid: "bootstrap-script", targetUid: uid, details: { emailVerified: user.emailVerified === true, exception: user.emailVerified !== true } })
    await batch.commit()
  }
  return { uid, email: user.email, claimChanged: result.changed, claimVerified: true, emailVerified: user.emailVerified === true, recordRole: record.role }
}

async function status() {
  const snap = await fb.db().collection(COL.superAdmin).get()
  const rows = []
  for (const d of snap.docs) {
    const r = d.data()
    let user = null
    try { user = await fb.auth().getUser(d.id) } catch (e) { if (!e || e.code !== "auth/user-not-found") throw e }
    const claim = !!(user && user.customClaims && user.customClaims.superAdmin === true)
    const problems = []
    if (!user) problems.push("ORPHAN: no Authentication account")
    if (r.uid !== d.id) problems.push("uid field != document id")
    if (r.role !== "super_admin") problems.push(`role is "${r.role}"`)
    if (r.active === true && user && !claim) problems.push("active but claim missing (run sync)")
    if (r.active !== true && claim) problems.push("inactive but claim present (run sync)")
    if (user && r.active === true && !user.emailVerified) problems.push("email not verified: admin powers inert until verified")
    rows.push({ uid: d.id, email: r.email, active: r.active === true, claim, problems })
  }
  return rows
}
module.exports = { bootstrap, status, syncOne: (uid) => platform.syncClaim("superAdmin", uid), OLD_PROJECT, fail }
