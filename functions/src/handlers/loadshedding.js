"use strict"
const fb = require("../lib/firebase")
const { COL, LIMITS } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")
const { writeAudit } = require("../lib/audit")

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const RANGE = /^\d{2}:\d{2} - \d{2}:\d{2}$/

function validateItem(item, i) {
  const o = V.object(item, `schedules[${i}]`)
  V.onlyKeys(o, ["suburb", "schedule"], `schedules[${i}]`)
  const suburb = V.str(o.suburb, "suburb", { max: 80 })
  const schedule = V.object(o.schedule, "schedule")
  const out = {}
  for (const [stage, days] of Object.entries(schedule)) {
    if (!/^stage_[1-8]$/.test(stage)) throw V.bad(`Invalid stage "${stage}"`)
    const dd = V.object(days, stage)
    out[stage] = {}
    for (const [day, ranges] of Object.entries(dd)) {
      if (!DAYS.includes(day)) throw V.bad(`Invalid day "${day}"`)
      if (!Array.isArray(ranges) || ranges.length > 12 || !ranges.every((r) => typeof r === "string" && RANGE.test(r))) throw V.bad(`Invalid times for ${stage}/${day}`)
      out[stage][day] = ranges
    }
  }
  const id = suburb.toLowerCase().replace(/[\/\\]/g, "-")
  if (id === "." || id === ".." || /^__.*__$/.test(id)) throw V.bad("Invalid suburb")
  return { id, suburb, schedule: out }
}

// Super-admin-only. The caller supplies the APPROVED data; nothing is bundled or auto-seeded.
// Existing suburbs are skipped unless overwrite:true AND confirmOverwrite:"OVERWRITE". Re-running is safe.
async function seedLoadshedding(request) {
  const actor = await G.requireActiveSuperAdmin(request)
  const d = V.object(request.data)
  V.onlyKeys(d, ["schedules", "overwrite", "confirmOverwrite"])
  if (!Array.isArray(d.schedules) || d.schedules.length === 0 || d.schedules.length > LIMITS.LOADSHEDDING_MAX_DOCS) throw V.bad("schedules must be a non-empty list")
  const overwrite = d.overwrite === true
  if (overwrite && d.confirmOverwrite !== "OVERWRITE") throw V.bad('Overwriting requires confirmOverwrite: "OVERWRITE"')
  const items = d.schedules.map(validateItem)
  if (new Set(items.map((i) => i.id)).size !== items.length) throw V.bad("Duplicate suburbs in request")

  const col = fb.db().collection(COL.loadshedding)
  const FV = fb.FieldValue()
  const existing = new Set()
  for (let i = 0; i < items.length; i += 50) {
    const snaps = await Promise.all(items.slice(i, i + 50).map((it) => col.doc(it.id).get()))
    snaps.forEach((s, k) => { if (s.exists) existing.add(items[i + k].id) })
  }
  const toWrite = items.filter((it) => overwrite || !existing.has(it.id))
  const skipped = items.length - toWrite.length
  const overwritten = toWrite.filter((it) => existing.has(it.id)).length
  for (let i = 0; i < toWrite.length; i += 400) {
    const batch = fb.db().batch()
    toWrite.slice(i, i + 400).forEach((it) => batch.set(col.doc(it.id), { suburb: it.suburb, schedule: it.schedule, isActive: true, seededBy: actor.uid, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() }))
    if (i + 400 >= toWrite.length) writeAudit(batch, { action: "loadshedding.seed", actorUid: actor.uid, details: { created: toWrite.length - overwritten, overwritten, skipped } })
    await batch.commit()
  }
  if (toWrite.length === 0) return { ok: true, created: 0, overwritten: 0, skipped }
  return { ok: true, created: toWrite.length - overwritten, overwritten, skipped }
}
module.exports = { seedLoadshedding }
