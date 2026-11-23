"use strict"
// Backend-recorded acknowledgement of the AI Service Notice, one document per authenticated user: ai-consent/{uid}
//   { uid, noticeVersion, active, acceptedAt, withdrawnAt, updatedAt }   -- no conversation content, ever.
// Clients cannot read or write it (rules deny everything not declared). Only aiSetLunaConsent writes it, only aiChat/aiGetUsage read it.
//  * accept   -> active for the CURRENT notice version
//  * withdraw -> active=false immediately: Luna is never used again for this user. It does NOT delete any conversation.
//  * a user who accepted an older notice version is treated as not having consented to the current one
// Deleting a conversation or "all my conversations" never touches this record. Its retention after account deletion is a policy decision
// recorded in docs/stage2/LUNA_PHASE1.md and settled in the privacy/POPIA review.
const fb = require("../lib/firebase")
const { AI_COL } = require("./constants")
const { NOTICE_VERSION } = require("./luna/constants")

const ref = (uid) => fb.db().collection(AI_COL.consent).doc(uid)
const isActive = (d) => !!d && d.active === true && d.noticeVersion === NOTICE_VERSION
async function getConsent(uid) {
  const s = await ref(uid).get()
  const d = s.exists ? s.data() : null
  return { active: isActive(d), noticeVersion: NOTICE_VERSION, acceptedVersion: d ? d.noticeVersion || null : null, withdrawn: !!d && d.active === false }
}
async function setConsent(uid, action) {
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const s = await tx.get(ref(uid))
    const prev = s.exists ? s.data() : null
    if (action === "accept") tx.set(ref(uid), { uid, noticeVersion: NOTICE_VERSION, active: true, acceptedAt: FV.serverTimestamp(), withdrawnAt: null, updatedAt: FV.serverTimestamp() })
    else tx.set(ref(uid), { uid, noticeVersion: prev ? prev.noticeVersion || NOTICE_VERSION : NOTICE_VERSION, active: false, acceptedAt: prev ? prev.acceptedAt || null : null, withdrawnAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })
    return { active: action === "accept", noticeVersion: NOTICE_VERSION }
  })
}
module.exports = { getConsent, setConsent, isActive, NOTICE_VERSION }
