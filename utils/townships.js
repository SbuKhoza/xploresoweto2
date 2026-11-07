// ═════════════════════════════════════════════════════════════════════════════
// Township data is fully dynamic: it lives in Firestore (collection `homescreen`,
// docs with type "township") and is edited from the Xplore CMS → Soweto → Townships.
// Nothing about individual townships is bundled with the app any more.
//
// Document shape (all fields optional except `name`):
//   name, area, tagline, established, namedAfter, overview (or description/about),
//   colorFrom, colorTo, imageUrl, order, isActive, aliases[],
//   history:   [{ year, text }]            (plain strings also accepted)
//   people:    [{ name, role, note }]
//   landmarks: [{ name, icon, text }]
//   facts:     [string]
//
// This file only normalises a document into what the screens render.
// ═════════════════════════════════════════════════════════════════════════════

// Used only when a township has no colours set in the CMS (rotates by position)
export const TOWNSHIP_COLORS = [
  ["#E8600A", "#A63A06"],
  ["#0A86B4", "#12407E"],
  ["#1FA463", "#0B6B45"],
  ["#7A4FE0", "#43299E"],
  ["#E0356F", "#9B1D4E"],
  ["#0E8F94", "#145A6B"],
]

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()

const toHistory = (v) => {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? { text: x } : { year: x?.year, text: x?.text || x?.description }))
      .filter((x) => x.text)
  }
  if (typeof v === "string") return v.split(/\n+/).map((t) => t.trim()).filter(Boolean).map((text) => ({ text }))
  return []
}
const toLines = (v) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+/) : [])
    .map((x) => (typeof x === "string" ? x.trim() : x?.text || ""))
    .filter(Boolean)
const toPeople = (v) =>
  (Array.isArray(v) ? v : [])
    .map((p) => (typeof p === "string" ? { name: p } : { name: p?.name, role: p?.role || p?.knownFor, note: p?.note || p?.description }))
    .filter((p) => p.name)
const toLandmarks = (v) =>
  (Array.isArray(v) ? v : [])
    .map((l) => (typeof l === "string" ? { name: l } : { name: l?.name, text: l?.text || l?.description, icon: l?.icon }))
    .filter((l) => l.name)

/** Sort order used everywhere: CMS `order` first, then A–Z. */
export const compareTownships = (a, b) => {
  const oa = a.order != null && a.order !== "" ? Number(a.order) : 1e9
  const ob = b.order != null && b.order !== "" ? Number(b.order) : 1e9
  return oa - ob || String(a.name).localeCompare(String(b.name))
}

/**
 * Builds the info object the screens render. `t` is a Firestore township doc
 * ({ id, name, ...fields }) or just a name string (e.g. from a search result).
 */
export const getTownshipInfo = (t, index = 0) => {
  const doc = typeof t === "string" ? { name: t } : t || {}
  const fallbackColors = TOWNSHIP_COLORS[index % TOWNSHIP_COLORS.length]
  return {
    key: doc.id || norm(doc.name) || `township-${index}`,
    name: doc.name || "Township",
    area: doc.area || "",
    tagline: doc.tagline || `${doc.name || "This township"} is part of greater Soweto.`,
    established: doc.established || null,
    namedAfter: doc.namedAfter || null,
    overview: doc.overview || doc.description || doc.about || "",
    imageUrl: doc.imageUrl || doc.image || null,
    colors: [doc.colorFrom || fallbackColors[0], doc.colorTo || fallbackColors[1]],
    history: toHistory(doc.history),
    people: toPeople(doc.people || doc.celebrities || doc.notablePeople),
    landmarks: toLandmarks(doc.landmarks),
    facts: toLines(doc.facts || doc.funFacts),
    aliases: Array.isArray(doc.aliases) ? doc.aliases : [],
  }
}
