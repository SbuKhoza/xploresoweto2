"use strict"
// The ONLY place the assistant touches Firestore. Rules of access:
//  * a fixed allow-list of public collections, enforced HERE (a collection name that is not on it throws, whatever the caller does)
//  * only documents with isActive == true, and, when a document is linked to an organisation, only if that organisation is
//    approved AND active (defence in depth: Stage 1 already hides a suspended organisation's listings by flipping isActive)
//  * the organisations collection is read ONLY to learn that status; none of its content is ever returned
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")
const { PUBLIC_READ_COLLECTIONS } = require("../constants")

const allowed = (collection) => { if (!PUBLIC_READ_COLLECTIONS.includes(collection)) throw new Error("collection_not_allowed") }

const cache = new Map()
const clearToolCache = () => cache.clear()

async function orgsActive(ids) {
  const out = new Map()
  await Promise.all([...new Set(ids)].slice(0, 100).map(async (id) => {
    const s = await fb.db().collection("organisations").doc(id).get()
    out.set(id, s.exists && s.data().approvalStatus === "approved" && s.data().active === true)
  }))
  return out
}
const visibleShape = (d) => d && d.isActive === true && (d.listingStatus === undefined || d.listingStatus === "published")

async function filterVisible(rows) {
  const base = rows.filter((r) => visibleShape(r.data))
  const linked = base.filter((r) => typeof r.data.organisationId === "string")
  if (!linked.length) return base
  const ok = await orgsActive(linked.map((r) => r.data.organisationId))
  return base.filter((r) => typeof r.data.organisationId !== "string" || ok.get(r.data.organisationId) === true)
}
async function loadActive(collection, cfg, limit = 200) {
  allowed(collection)
  limit = Math.min(Math.max(1, limit | 0), 500)
  const ttl = (cfg.cache.listingTtlSeconds || 0) * 1000, now = clock.now().getTime()
  const hit = cache.get(`${collection}:${limit}`)
  if (ttl && hit && now - hit.at < ttl) return hit.rows
  const snap = await fb.db().collection(collection).where("isActive", "==", true).limit(limit).get()
  const rows = await filterVisible(snap.docs.map((d) => ({ id: d.id, data: d.data() })))
  // Firestore has no full-text search, so a category is scanned in memory. If the scan hit its cap the result may be INCOMPLETE:
  // callers must say so instead of implying they searched everything.
  rows.truncated = snap.docs.length >= limit
  rows.scanned = snap.docs.length
  if (ttl) cache.set(`${collection}:${limit}`, { at: now, rows })
  return rows
}
async function getVisible(collection, id) {
  allowed(collection)
  const s = await fb.db().collection(collection).doc(id).get()
  if (!s.exists) return null
  const rows = await filterVisible([{ id: s.id, data: s.data() }])
  return rows[0] || null
}
module.exports = { loadActive, getVisible, filterVisible, clearToolCache }
