"use strict"
// Follow-up context. A small, bounded object stored on the owner-only conversation document (no new collection):
//   { slots: { budget, party, dateIso, dateLabel, duration, interests, categories, place }, lastRefs: [listing refs], pending: "plan"|null }
// Rules: only values the USER stated are stored (never inferred); a new value in the message always wins; carried values are reported
// back to the user so nothing is used silently; context read from storage is re-validated (a tampered document cannot widen anything).
const REF = /^listing:[a-z-]+\/[A-Za-z0-9_.-]{1,128}$/
const MAX_REFS = 6
const empty = () => ({ slots: {}, lastRefs: [], pending: null })
const arr = (v, n, ok) => (Array.isArray(v) ? v.filter(ok).slice(0, n) : [])
const str = (v, n) => (typeof v === "string" && v.length <= n ? v : null)
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null)

function sanitize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty()
  const s = raw.slots && typeof raw.slots === "object" ? raw.slots : {}
  const slots = {}
  if (s.budget && typeof s.budget === "object" && num(s.budget.max, 1, 1000000) !== null) slots.budget = { amount: s.budget.max, min: num(s.budget.min, 0, 1000000) ?? 0, max: s.budget.max, kind: ["total", "max", "range"].includes(s.budget.kind) ? s.budget.kind : "total", perPerson: s.budget.perPerson === true, approx: false, currency: "ZAR" }
  if (s.party && typeof s.party === "object" && num(s.party.total, 1, 50) !== null) slots.party = { total: s.party.total, children: num(s.party.children, 1, 30), adults: null }
  if (str(s.dateIso, 10) && /^\d{4}-\d{2}-\d{2}$/.test(s.dateIso)) { slots.dateIso = s.dateIso; slots.dateLabel = str(s.dateLabel, 40) || s.dateIso }
  if (s.duration && ["half_day", "full_day", "multi_day"].includes(s.duration.kind) && num(s.duration.days, 0.5, 14) !== null) slots.duration = { kind: s.duration.kind, days: s.duration.days }
  const interests = arr(s.interests, 6, (x) => typeof x === "string" && /^[a-z]{3,20}$/.test(x)); if (interests.length) slots.interests = interests
  const categories = arr(s.categories, 4, (x) => typeof x === "string" && /^[a-z]{3,20}$/.test(x)); if (categories.length) slots.categories = categories
  if (str(s.place, 80)) slots.place = s.place
  return { slots, lastRefs: arr(raw.lastRefs, MAX_REFS, (x) => typeof x === "string" && REF.test(x)), pending: raw.pending === "plan" ? "plan" : null }
}

// Effective slots for this turn = what the message says, else (if allowed) what was said earlier. `carried` lists what came from before.
function merge(ents, prev, { carry }) {
  const p = sanitize(prev).slots, carried = []
  const use = (key, label, fromMsg, fromPrev, show) => {
    if (fromMsg) return fromMsg
    if (carry.includes(key) && fromPrev) { carried.push(`${label} ${show(fromPrev)}`); return fromPrev }
    return null
  }
  const dateMsg = ents.date && !ents.date.past ? { iso: ents.date.iso, label: ents.date.label } : null
  const datePrev = p.dateIso ? { iso: p.dateIso, label: p.dateLabel } : null
  const interests = ents.interests.length ? ents.interests : carry.includes("interests") && p.interests ? (carried.push(`your interest in ${p.interests.join(" and ")}`), p.interests) : []
  return {
    budget: use("budget", "your budget of", ents.budget, p.budget, (b) => `R${b.max}`),
    party: use("party", "a group of", ents.party, p.party, (x) => String(x.total)),
    date: use("date", "the date", dateMsg, datePrev, (d) => d.label),
    duration: use("duration", "a visit of", ents.duration, p.duration, (d) => (d.kind === "half_day" ? "half a day" : `${d.days} day${d.days === 1 ? "" : "s"}`)),
    place: use("place", "the area", ents.places[0] || null, p.place || null, (x) => x),
    interests, carried,
  }
}

function next(prev, { slots, refs, pending }) {
  const old = sanitize(prev)
  const s = { ...old.slots }
  if (slots.budget) s.budget = slots.budget
  if (slots.party) s.party = slots.party
  if (slots.date) { s.dateIso = slots.date.iso; s.dateLabel = slots.date.label }
  if (slots.duration) s.duration = slots.duration
  if (slots.interests && slots.interests.length) s.interests = slots.interests
  if (slots.categories && slots.categories.length) s.categories = slots.categories
  if (slots.place) s.place = slots.place
  return sanitize({ slots: s, lastRefs: refs && refs.length ? refs : old.lastRefs, pending: pending || null })
}
module.exports = { sanitize, merge, next, empty, MAX_REFS }
