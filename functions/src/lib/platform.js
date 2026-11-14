"use strict"
// Platform roles. The Firestore record is AUTHORITATIVE; the custom claim is derived from it and is only ever
// set/cleared here, after reading the record. A claim by itself never grants access (see guards.js).
const fb = require("./firebase")
const { COL } = require("./constants")

const KINDS = Object.freeze({
  superAdmin: { col: COL.superAdmin, claim: "superAdmin", role: "super_admin" },
  editor: { col: COL.editors, claim: "editor", role: "editor" },
})

async function syncClaim(kindKey, uid) {
  const kind = KINDS[kindKey]
  const [rec, user] = await Promise.all([fb.db().collection(kind.col).doc(uid).get(), fb.auth().getUser(uid)])
  const should = rec.exists && rec.data().active === true && rec.data().role === kind.role && rec.data().uid === uid
  const claims = { ...(user.customClaims || {}) }
  const has = claims[kind.claim] === true
  if (should === has) return { changed: false, hasClaim: has }
  if (should) claims[kind.claim] = true; else delete claims[kind.claim]
  await fb.auth().setCustomUserClaims(uid, Object.keys(claims).length ? claims : null)
  if (!should) await fb.auth().revokeRefreshTokens(uid) // existing sessions must refresh and lose the claim
  return { changed: true, hasClaim: should }
}
module.exports = { KINDS, syncClaim }
