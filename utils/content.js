// Shared helpers + placeholder content for the Home, Events and News screens.
import dayjs from "dayjs"

// ── Design tokens (mirror tailwind.config.js) ───────────────────────────────
export const TEAL  = "#1B4D5C"
export const BRAND = "#E8600A"
export const MUTED = "#7A8A8F"

export const cardShadow = {
  shadowColor: TEAL,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
}

// ── Bundled fallback images ─────────────────────────────────────────────────
export const EVENT_FALLBACK_IMAGE = require("../assets/Soweto1.png")
export const NEWS_FALLBACK_IMAGE  = require("../assets/home/story-towers.jpg")

// ── Dates ───────────────────────────────────────────────────────────────────
// Firestore Timestamps may arrive as Timestamp objects, {seconds}, ISO strings…
export const toDate = (v) => {
  if (!v) return null
  if (typeof v.toDate === "function") return v.toDate()
  if (typeof v === "object" && (v.seconds ?? v._seconds) != null) return new Date((v.seconds ?? v._seconds) * 1000)
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// ── Images ──────────────────────────────────────────────────────────────────
// Documents may store their picture under a few different field names.
const pickUrl = (o) => {
  const url = o.imageUrl || o.image || o.photo || o.thumbnail || o.coverImage
  return typeof url === "string" && url.trim() ? url.trim() : null
}
export const eventImage = (e) => { const u = pickUrl(e); return u ? { uri: u } : null }
export const newsImage  = (a) => { const u = pickUrl(a); return u ? { uri: u } : (a.localImage || null) }

// ── Events ──────────────────────────────────────────────────────────────────
export const normaliseEvent = (e) => ({ ...e, _date: toDate(e.date || e.startDate) })

// "10:00" from the event's own `time` field, or from its date when that has a time part
export const eventTime = (e) => {
  if (e.time) return e.time
  const d = dayjs(e._date)
  return (d.hour() || d.minute()) ? d.format("HH:mm") : null
}

// ── News ────────────────────────────────────────────────────────────────────
const NEWS_TAG = {
  "local news": TEAL, municipal: TEAL, community: "#22A559",
  business: BRAND, events: BRAND, safety: "#DC3B3B",
}
export const tagColor = (c = "") => NEWS_TAG[String(c).toLowerCase()] || TEAL

export const readingTime = (text = "") => {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

// Case-insensitive "does any field contain the query"
export const matchesQuery = (item, query, fields) => {
  const q = (query || "").trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => String(item[f] ?? "").toLowerCase().includes(q))
}
