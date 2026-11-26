"use strict"
// Turns the heterogeneous listing documents (CMS-authored, free-text hours and prices) into one small, SANITISED shape.
// Two outputs per document: `model` (what the language model may see: no image URLs, no internal ids, no organisation data) and
// `evidence` (server-side copy used by the grounding validator and to build cards). Missing information is reported, never guessed.
const { sanitizeText } = require("../sanitize")
const { readCoords, approxKm } = require("../geo")
const { BOOKABLE_COLLECTIONS: BOOKABLE } = require("../constants") // a listing linked to a provider organisation can receive a booking REQUEST (the provider decides)

const pick = (d, ...keys) => { for (const k of keys) { const v = d[k]; if (v !== undefined && v !== null && v !== "") return v } return undefined }
const SAST_MS = 2 * 3600000
const sastParts = (ms) => { const t = new Date(ms + SAST_MS); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() } }
const ymd = (ms) => { const p = sastParts(ms); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` }
const sastDayStartMs = (ms) => { const p = sastParts(ms); return Date.UTC(p.y, p.m - 1, p.d) - SAST_MS }

function toMillis(v) {
  if (!v) return NaN
  if (typeof v.toMillis === "function") return v.toMillis()
  if (v instanceof Date) return v.getTime()
  if (typeof v === "number") return v
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) - SAST_MS // date-only = that SAST day
    const t = Date.parse(v); return Number.isNaN(t) ? NaN : t
  }
  return NaN
}

function numbersIn(text) {
  const out = []
  for (const m of String(text).matchAll(/\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) out.push(parseFloat(m[0].replace(/[ ,]/g, "")))
  return out
}
// Pricing units. Structured (optional, backward compatible): a record may carry `priceUnit` (or `pricing.unit`) with one of
//   per_person | per_group | per_room | per_night | free | unknown
// Old records have only free text, so the unit is read from clear wording ("per person", "pp", "per night"...) and is otherwise "unknown".
// "unknown" is never guessed: callers must treat it conservatively (see engine/itinerary.js).
const UNITS = Object.freeze(["per_person", "per_group", "per_room", "per_night", "free", "unknown"])
const UNIT_WORDS = [[/\b(per|a|each|\/)\s*(person|head|adult|guest|pax)\b|\bpp\b|\bp\/p\b|\bper\s*pers\b/i, "per_person"], [/\b(per|a)\s*(group|table|tour|party|booking|car|vehicle)\b/i, "per_group"],
  [/\b(per|a|\/)\s*room\b/i, "per_room"], [/\b(per|a|\/)\s*night\b|\bnightly\b/i, "per_night"]]
function unitOf(text, stored, isFree) {
  const key = typeof stored === "string" ? stored.trim().toLowerCase().replace(/[\s-]+/g, "_") : ""
  const alias = { person: "per_person", pp: "per_person", per_head: "per_person", group: "per_group", room: "per_room", night: "per_night", nightly: "per_night" }
  const st = UNITS.includes(key) ? key : alias[key] || null
  if (st) return { unit: st, source: "stored" }
  if (isFree) return { unit: "free", source: "text" }
  for (const [re, u] of UNIT_WORDS) if (text && re.test(text)) return { unit: u, source: "text" }
  return { unit: "unknown", source: "none" }
}
function parsePrice(raw, unitRaw) {
  const none = { text: null, min: null, max: null, known: false, numbers: [], unit: "unknown", unitSource: "none" }
  if (raw === undefined || raw === null || raw === "") return unitRaw && /^free$/i.test(String(unitRaw)) ? { ...none, text: "Free", min: 0, max: 0, known: true, numbers: [0], unit: "free", unitSource: "stored" } : none
  if (typeof raw === "number" && Number.isFinite(raw)) { const u = unitOf(null, unitRaw, raw === 0); return { text: raw === 0 ? "Free" : `R${raw}`, min: raw, max: raw, known: true, numbers: [raw], unit: raw === 0 ? "free" : u.unit, unitSource: raw === 0 ? "text" : u.source } }
  const text = sanitizeText(raw, 60)
  if (!text) return none
  if (/\bfree\b/i.test(text)) return { text, min: 0, max: 0, known: true, numbers: [0], unit: "free", unitSource: "text" }
  const numbers = numbersIn(text), u = unitOf(text, unitRaw, false)
  return numbers.length ? { text, min: Math.min(...numbers), max: Math.max(...numbers), known: true, numbers, unit: u.unit, unitSource: u.source } : { ...none, text }
}

// 'open' / 'closed' ONLY for the two unambiguous patterns (a single daily "HH:MM - HH:MM" range, or 24 hours). Everything else
// (days of week, several ranges, AM/PM, free prose) is 'unknown': the assistant may quote the text but must not claim open/closed.
function computeOpenStatus(text, nowMs) {
  if (!text) return "unknown"
  const t = String(text).toLowerCase().trim()
  const hasDays = /\b(mon|tue|wed|thu|fri|sat|sun|weekday|weekend|closed|public holiday)/.test(t)
  if (!hasDays && /\b(24\s*\/\s*7|24\s*(hours?|hrs?)|open 24)\b/.test(t)) return "open"
  if (hasDays || /[;,|]/.test(t) || /[ap]m\b/.test(t)) return "unknown"
  const m = t.match(/^(?:[a-z ]*?)(\d{1,2})[:h.](\d{2})\s*(?:-|–|—|to)\s*(\d{1,2})[:h.](\d{2})(?:[a-z .]*)$/)
  if (!m) return "unknown"
  const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4]
  if (+m[1] > 24 || +m[3] > 24 || +m[2] > 59 || +m[4] > 59) return "unknown"
  const now = sastParts(nowMs).minutes
  const open = a === b ? false : a < b ? now >= a && now < b : now >= a || now < b
  return open ? "open" : "closed"
}

const TAG_FIELDS = ["tags", "features", "amenities", "specialDishes", "activities", "specialties", "services"]
function collectTags(d) {
  const out = []
  for (const f of TAG_FIELDS) if (Array.isArray(d[f])) for (const x of d[f]) { const s = sanitizeText(x, 40); if (s && !out.includes(s)) out.push(s) }
  return out.slice(0, 8)
}
const host = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, "").slice(0, 80) } catch { return "" } }
const ratingOf = (d) => (typeof d.rating === "number" && d.rating >= 0 && d.rating <= 5 ? Math.round(d.rating * 10) / 10 : null)
const reviewCountOf = (d) => { const n = pick(d, "ratingCount", "reviews"); return Number.isInteger(n) && n >= 0 ? n : null }
const firstImage = (d) => { const i = Array.isArray(d.images) ? d.images[0] : pick(d, "image", "imageUrl"); return typeof i === "string" && /^https:\/\//.test(i) ? i : null }

function summarizeListing(collection, id, d, ctx, { longDescription = false } = {}) {
  const ref = `listing:${collection}/${id}`
  const price = parsePrice(pick(d, "price", "entryFee", "fare", "priceRange", "cost"), pick(d, "priceUnit", "pricingUnit") || (d.pricing && typeof d.pricing === "object" ? d.pricing.unit : undefined))
  const hoursText = sanitizeText(pick(d, "openingHours", "hours", "operatingHours"), 120) || null
  const loc = pick(d, "location", "address")
  const coords = readCoords(d)
  const km = ctx.location && coords ? approxKm(ctx.location, coords) : null
  const rating = ratingOf(d), reviewCount = reviewCountOf(d)
  const m = {
    ref, name: sanitizeText(pick(d, "name", "title"), 120), category: sanitizeText(pick(d, "type", "category", "cuisine"), 60) || null,
    description: sanitizeText(pick(d, "description", "about", "summary"), longDescription ? 600 : 280) || null,
    address: sanitizeText(typeof loc === "object" && loc ? loc.address : loc, 140) || null,
    price: price.text, priceKnown: price.known, priceUnit: price.unit, hours: hoursText, openNow: computeOpenStatus(hoursText, ctx.now),
    rating, reviewCount, tags: collectTags(d), phone: sanitizeText(d.phone, 25) || null, websiteHost: host(d.website) || null,
    accessible: typeof d.accessibility === "boolean" ? d.accessibility : null,
    approxStraightLineKm: km,
  }
  const missing = []
  if (!price.known) missing.push("price"); if (!hoursText) missing.push("opening_hours"); if (!coords) missing.push("coordinates"); if (rating === null) missing.push("rating"); if (!m.description) missing.push("description")
  m.missing = missing
  const evidence = { ref, kind: "listing", collection, id, name: m.name, category: m.category, address: m.address, priceText: price.text, priceNumbers: price.numbers, priceUnit: price.unit, hoursText, openStatus: m.openNow, rating, reviewCount, approxKm: km, descText: m.description || "", imageUrl: firstImage(d), phone: m.phone, bookable: BOOKABLE.includes(collection) && typeof d.organisationId === "string" }
  return { model: m, evidence, coords, price }
}
module.exports = { UNITS, pick, toMillis, ymd, sastParts, sastDayStartMs, SAST_MS, parsePrice, numbersIn, computeOpenStatus, summarizeListing, collectTags, firstImage }
