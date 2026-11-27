"use strict"
// Pure helpers shared by the READ-ONLY listing audit and the dry-run-first repair script. Nothing here touches the network.
// Principle: a repair may only ADD what the CMS itself would have saved for an empty field (an empty list) or copy a value from another
// field of the SAME document (restaurants: `hours` -> `openingHours`). It never replaces an existing value and never invents data.
const crypto = require("crypto")

const LIST_FIELDS = {
  restaurants: ["tags", "specialDishes", "tableOptions", "images"],
  accommodations: ["amenities", "images"],
  attractions: ["features", "images"],
  recreation: ["activities", "images"],
  business: ["images", "services"],
  healthcare: ["specialties", "images"],
  publicservice: ["services", "images"],
  transport: ["departures", "stops"],
}
const COLLECTIONS = Object.keys(LIST_FIELDS)
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
const IMG = /^(https?:\/\/|data:image\/|file:\/\/|content:\/\/)/i
const usableEntry = (field, x) => {
  if (field === "images") return (typeof x === "string" && IMG.test(x.trim())) || (isObj(x) && [x.url, x.uri, x.src].some((u) => typeof u === "string" && IMG.test(u.trim())))
  if (field === "tableOptions") return Number.isFinite(Number(x)) && Number(x) > 0 && x !== "" && x !== null && typeof x !== "boolean"
  if (field === "services") return (typeof x === "string" && x.trim()) || (isObj(x) && typeof x.name === "string" && x.name.trim())
  return (typeof x === "string" && x.trim() !== "") || (isObj(x) && typeof (x.name || x.time) === "string")
}
const marked = (d) => isObj(d) && (d.isSample === true || d.synthetic === true)

/** Findings for one document: [{ field, code, repairable, detail }]. `detail` never contains document values. */
function auditDoc(collection, data) {
  const out = []
  const d = isObj(data) ? data : {}
  if (!isObj(data)) return [{ field: "(document)", code: "not-an-object", repairable: false, detail: `document is ${typeName(data)}` }]
  const nameKey = collection === "transport" ? "routeName" : "name"
  if (typeof d[nameKey] !== "string" || !d[nameKey].trim()) out.push({ field: nameKey, code: "missing-name", repairable: false, detail: "no usable name" })
  for (const f of LIST_FIELDS[collection] || []) {
    const v = d[f]
    if (v === undefined) out.push({ field: f, code: "missing-list", repairable: true, detail: "absent; would be set to []" })
    else if (v === null) out.push({ field: f, code: "null-list", repairable: true, detail: "null; would be set to []" })
    else if (!Array.isArray(v)) out.push({ field: f, code: "wrong-type-list", repairable: false, detail: `is ${typeName(v)}; needs manual review (value is preserved by the app)` })
    else {
      const bad = v.filter((x) => !usableEntry(f, x)).length
      if (bad) out.push({ field: f, code: "invalid-entries", repairable: false, detail: `${bad} of ${v.length} entries unusable; needs manual review` })
    }
  }
  if (d.coordinates !== undefined && d.coordinates !== null) {
    const c = d.coordinates
    const ok = isObj(c) && Number.isFinite(Number(c.latitude ?? c.lat)) && Number.isFinite(Number(c.longitude ?? c.lng ?? c.lon)) && Math.abs(Number(c.latitude ?? c.lat)) <= 90 && Math.abs(Number(c.longitude ?? c.lng ?? c.lon)) <= 180
    if (!ok) out.push({ field: "coordinates", code: "bad-coordinates", repairable: false, detail: "not a valid latitude/longitude pair; needs manual review" })
  }
  if (collection === "restaurants" && (typeof d.openingHours !== "string" || !d.openingHours.trim()) && typeof d.hours === "string" && d.hours.trim())
    out.push({ field: "openingHours", code: "legacy-hours", repairable: true, detail: "copy the document's own `hours` text into `openingHours` (the field the app reads)" })
  if (collection === "transport" && (typeof d.mode !== "string" || !d.mode.trim())) out.push({ field: "mode", code: "missing-mode", repairable: false, detail: "no transport mode; the app shows 'other' (not guessed)" })
  return out
}

/** The additive patch for one document: only repairable findings, only fields that are STILL absent/null/empty right now. */
function planRepair(collection, data) {
  const patch = {}
  for (const f of auditDoc(collection, data)) {
    if (!f.repairable) continue
    if (f.code === "legacy-hours") patch.openingHours = data.hours.trim()
    else patch[f.field] = []
  }
  return patch
}

const planHash = (rows) => crypto.createHash("sha256").update(JSON.stringify(rows.map((r) => [r.path, r.patch]).sort((a, b) => (a[0] < b[0] ? -1 : 1)))).digest("hex")

/** READ-ONLY: only `.get()` on collections. Returns { counts, documents:[{path, marked, findings}] } with no document contents. */
async function runAudit(db, collections = COLLECTIONS) {
  const documents = []
  for (const c of collections) {
    const snap = await db.collection(c).get()
    for (const doc of snap.docs) documents.push({ path: `${c}/${doc.id}`, collection: c, marked: marked(doc.data()), findings: auditDoc(c, doc.data()) })
  }
  const counts = { documents: documents.length, withFindings: documents.filter((d) => d.findings.length).length, repairable: documents.filter((d) => d.findings.some((f) => f.repairable)).length, needReview: documents.filter((d) => d.findings.some((f) => !f.repairable)).length }
  return { counts, documents }
}

/** Builds the repair plan from a fresh read: only sample/synthetic-marked documents, only additive patches. No writes. */
async function buildPlan(db, collections = COLLECTIONS) {
  const rows = []
  for (const c of collections) {
    const snap = await db.collection(c).get()
    for (const doc of snap.docs) {
      const data = doc.data()
      if (!marked(data)) continue // user/CMS-created records are never touched by the repair
      const patch = planRepair(c, data)
      if (Object.keys(patch).length) rows.push({ path: `${c}/${doc.id}`, collection: c, id: doc.id, patch })
    }
  }
  return { rows, hash: planHash(rows) }
}

/**
 * Applies a plan. Refuses unless `approvedHash` equals the hash of a FRESH plan (so the approval is for exactly what will be written), and each
 * write is a transaction that re-reads the document and writes only fields that are still absent/null (so a concurrent edit is never overwritten).
 */
async function applyPlan(db, { approvedHash, collections = COLLECTIONS }) {
  const plan = await buildPlan(db, collections)
  if (!approvedHash || approvedHash !== plan.hash) throw new Error(`Approval does not match the current plan (current plan hash ${plan.hash}). Review the dry run again.`)
  const result = { written: 0, skipped: 0, fields: 0 }
  for (const r of plan.rows) {
    const ref = db.collection(r.collection).doc(r.id)
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) { result.skipped += 1; return }
      const cur = snap.data()
      const patch = planRepair(r.collection, cur) // recomputed against the data as it is right now
      if (!marked(cur) || !Object.keys(patch).length) { result.skipped += 1; return }
      tx.update(ref, patch)
      result.written += 1; result.fields += Object.keys(patch).length
    })
  }
  return result
}

module.exports = { LIST_FIELDS, COLLECTIONS, auditDoc, planRepair, planHash, runAudit, buildPlan, applyPlan, marked }
