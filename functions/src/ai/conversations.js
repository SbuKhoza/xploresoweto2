"use strict"
// Conversation storage. Collections are CLIENT-INACCESSIBLE (rules deny all): every read/write goes through functions that check
// ownership, so a user can never read, continue, list or delete another user's conversation. A non-owner gets the SAME
// "not-found" as a missing conversation (no existence leak).
//   ai-conversations/{cid}                { ownerUid, title, createdAt, updatedAt, messageCount, expireAt, engine, context, language }
//   ai-conversations/{cid}/messages/{mid} { ownerUid, conversationId, role, text, blocks?, cardRefs?, followUps?, ... , createdAt, expireAt }
// Retention: expireAt = last activity + retention.days, used by a Firestore TTL policy as a BACKUP. User-triggered deletion below is
// immediate and never depends on TTL. Precise location and retrieved records are never stored (only listing references and a small follow-up context).
const { HttpsError } = require("firebase-functions/v2/https")
const fb = require("../lib/firebase")
const clock = require("../lib/clock")
const { sha256hex } = require("../lib/crypto")
const { AI_COL, MESSAGES } = require("./constants")
const { sanitizeText } = require("./sanitize")

const notFound = () => new HttpsError("not-found", "conversation-not-found")
const convRef = (cid) => fb.db().collection(AI_COL.conversations).doc(cid)
const msgsCol = (cid) => convRef(cid).collection(MESSAGES)
const deterministicConversationId = (uid, requestId) => `c_${sha256hex(`${uid}:${requestId}`).slice(0, 24)}`
const expiry = (days) => fb.Timestamp().fromMillis(clock.now().getTime() + days * 86400000)

async function loadOwned(uid, cid) { // -> data | null (missing). Throws not-found when it exists but is someone else's.
  const s = await convRef(cid).get()
  if (!s.exists) return null
  if (s.data().ownerUid !== uid) throw notFound()
  return s.data()
}
async function findStoredReply(uid, cid, requestId) {
  const conv = await loadOwned(uid, cid)
  if (!conv) return null
  const s = await msgsCol(cid).doc(`${requestId}_a`).get()
  return s.exists && s.data().ownerUid === uid ? { id: s.id, ...s.data() } : null
}
// Follow-up context (small, bounded, written only by the server; see engine/context.js). Not conversation text.
async function loadContext(uid, cid) {
  const conv = await loadOwned(uid, cid)
  return conv ? conv.context || null : null
}

// Idempotent: the assistant message id is derived from requestId, so a retry can never add a second copy.
async function persistTurn({ uid, cid, requestId, userText, assistant, context, cfg }) {
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const cRef = convRef(cid), uRef = msgsCol(cid).doc(`${requestId}_u`), aRef = msgsCol(cid).doc(`${requestId}_a`)
    const [cSnap, aSnap] = [await tx.get(cRef), await tx.get(aRef)]
    if (cSnap.exists && cSnap.data().ownerUid !== uid) throw notFound()
    if (aSnap.exists) return { id: aSnap.id, ...aSnap.data(), duplicate: true }
    const exp = expiry(cfg.retention.days)
    const at = fb.Timestamp().fromMillis(clock.now().getTime())
    const at2 = fb.Timestamp().fromMillis(clock.now().getTime() + 1) // keeps the user message strictly before its reply
    tx.set(uRef, { ownerUid: uid, conversationId: cid, role: "user", text: userText, requestId, createdAt: at, expireAt: exp })
    const aDoc = { ownerUid: uid, conversationId: cid, role: "assistant", requestId, createdAt: at2, expireAt: exp, ...assistant }
    tx.set(aRef, aDoc)
    const prev = cSnap.exists ? cSnap.data() : null
    tx.set(cRef, {
      ownerUid: uid, title: prev ? prev.title : sanitizeText(userText, 60) || "New conversation",
      createdAt: prev ? prev.createdAt : at, updatedAt: at2, messageCount: (prev ? prev.messageCount : 0) + 2, expireAt: exp,
      engine: assistant.engine || null, context: context || (prev && prev.context) || null, language: assistant.language || (prev && prev.language) || null,
    })
    return { id: aRef.id, ...aDoc, duplicate: false }
  })
}

async function listConversations(uid, limit = 20) {
  const snap = await fb.db().collection(AI_COL.conversations).where("ownerUid", "==", uid).orderBy("updatedAt", "desc").limit(Math.min(Math.max(limit, 1), 50)).get()
  return snap.docs.map((d) => { const c = d.data(); return { conversationId: d.id, title: c.title, updatedAt: c.updatedAt.toMillis(), messageCount: c.messageCount } })
}
async function getConversation(uid, cid, limit = 100) {
  const conv = await loadOwned(uid, cid)
  if (!conv) throw notFound()
  const snap = await msgsCol(cid).orderBy("createdAt", "asc").limit(Math.min(limit, 200)).get()
  return { conversation: { conversationId: cid, title: conv.title, updatedAt: conv.updatedAt.toMillis(), messageCount: conv.messageCount }, messages: snap.docs.filter((d) => d.data().ownerUid === uid).map((d) => ({ id: d.id, ...d.data() })) }
}
async function deleteMessages(cid) {
  let n = 0
  for (;;) {
    const snap = await msgsCol(cid).limit(400).get()
    if (snap.empty) return n
    const batch = fb.db().batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    n += snap.size
  }
}
async function deleteConversation(uid, cid) {
  const conv = await loadOwned(uid, cid)
  if (!conv) return { deleted: false } // already gone: idempotent
  await deleteMessages(cid)
  await convRef(cid).delete()
  return { deleted: true }
}
// Deletes everything the user has in the AI feature. Usage COUNTERS (numbers only, no content) are deliberately kept: otherwise
// "delete all my data" would reset the daily limit and become a way to bypass it.
async function deleteAllForUser(uid) {
  let conversations = 0
  for (;;) {
    const snap = await fb.db().collection(AI_COL.conversations).where("ownerUid", "==", uid).limit(50).get()
    if (snap.empty) return { conversations }
    for (const d of snap.docs) { await deleteMessages(d.id); await d.ref.delete(); conversations += 1 }
  }
}
module.exports = { deterministicConversationId, loadOwned, findStoredReply, loadContext, persistTurn, listConversations, getConversation, deleteConversation, deleteAllForUser, convRef, msgsCol, notFound }
