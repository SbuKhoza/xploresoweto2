"use strict"
// The ONLY place tools touch Firestore. Rules of access:
//  * a fixed allow-list of public collections (the model can never name a collection: it chooses from an enum)
//  * only documents with isActive == true, and, when a document is linked to an organisation, only if that organisation is
//    approved AND active (defence in depth: Stage 1 already hides a suspended organisation's listings by flipping isActive)
//  * the organisations collection is read ONLY to learn that status; none of its content is ever returned
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")

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
  const ttl = (cfg.cache.listingTtlSeconds || 0) * 1000, now = clock.now().getTime()
  const hit = cache.get(collection)
  if (ttl && hit && now - hit.at < ttl) return hit.rows
  const snap = await fb.db().collection(collection).where("isActive", "==", true).limit(limit).get()
  const rows = await filterVisible(snap.docs.map((d) => ({ id: d.id, data: d.data() })))
  if (ttl) cache.set(collection, { at: now, rows })
  return rows
}
async function getVisible(collection, id) {
  const s = await fb.db().collection(collection).doc(id).get()
  if (!s.exists) return null
  const rows = await filterVisible([{ id: s.id, data: s.data() }])
  return rows[0] || null
}
module.exports = { loadActive, getVisible, filterVisible, clearToolCache }
