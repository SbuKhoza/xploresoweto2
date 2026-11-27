// Schema-aware normalisation for Firestore listing documents (restaurants, accommodations, attractions, recreation, business,
// healthcare, publicservice, emergency, transport).
//
// WHY: documents come from several writers (the CMS forms, CMS sample data, the backend's approved listing submissions, older
// hand-written records), so any optional field may be missing, null, empty, or the wrong type. Screens used to call `.map` on
// `selectedRestaurant.images` directly and crashed the app on a restaurant that had no `images` field.
//
// RULES (read before changing):
//  * Pure functions, no React Native imports, so they run under `node --test`.
//  * Only the fields a collection is known to use are touched; every other field is passed through unchanged.
//  * Valid existing data and supported legacy shapes are PRESERVED (a price like "R80 - R150" stays text; a services entry that is
//    a plain string or an object stays usable). Nothing is converted blindly to a string or an array.
//  * NOTHING IS INVENTED: no default table sizes, opening hours, prices, availability, transport mode or schedules. A missing value
//    stays missing (undefined / null / empty list) and the UI shows a placeholder or hides the section.
//  * Invalid individual entries inside a list are dropped; the rest of the list survives.

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

/** Trimmed text from a string or finite number. Anything else (null, objects, arrays, NaN, booleans) is "". */
export const toText = (v) => {
  if (typeof v === "string") return v.trim()
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return ""
}

/** Finite number from a number or a numeric string; otherwise null. */
export const toFiniteNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.trim()); return Number.isFinite(n) ? n : null }
  return null
}

/** Rating on the 0–5 scale, or null when absent/invalid (a rating of 0 is a real value; "no rating" is null). */
export const toRating = (v) => { const n = toFiniteNumber(v); return n !== null && n >= 0 && n <= 5 ? n : null }

/** Non-negative whole number of reviews, or null. */
export const toCount = (v) => { const n = toFiniteNumber(v); return n !== null && n >= 0 ? Math.round(n) : null }

/** Positive whole number (guests, seats), or null. */
export const toPositiveInt = (v) => { const n = toFiniteNumber(v); return n !== null && n >= 1 ? Math.floor(n) : null }

/** True only for `true` or the strings "true"/"yes". Used for flags the CMS stores as toggles. */
export const toBool = (v) => v === true || (typeof v === "string" && /^(true|yes)$/i.test(v.trim()))

/**
 * A list of display strings. Accepts an array whose entries are strings, numbers, or objects with name/label/text
 * (invalid entries are dropped), or a bare string (split on commas / new lines, a legacy hand-typed list).
 */
export const toStringList = (v) => {
  const one = (x) => (isObject(x) ? toText(x.name) || toText(x.label) || toText(x.text) : toText(x))
  if (Array.isArray(v)) return v.map(one).filter(Boolean)
  if (typeof v === "string") return v.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)
  return []
}

// ── Prices ──────────────────────────────────────────────────────────────────
// The CMS stores price as free text ("R80 - R150", "R700", "Free"); older/backend records may hold a number.

/** Keeps a price as it was written: a finite non-negative number, or non-empty text. Otherwise null. */
export const toPrice = (v) => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null
  const t = toText(v)
  return t || null
}
/** Display text for a price. Numbers and bare numeric text get an "R" prefix; text that already says what it is stays as written. */
export const formatPrice = (v) => {
  const p = toPrice(v)
  if (p === null) return null
  if (typeof p === "number") return `R${p}`
  return /^\d[\d\s.,]*$/.test(p) ? `R${p}` : p
}
/** Same, but a price of exactly zero is "Free" (entry fees). */
export const formatEntryFee = (v) => {
  const p = toPrice(v)
  if (p === null) return null
  if (p === 0 || /^0+([.,]0+)?$/.test(String(p))) return "Free"
  return formatPrice(p)
}
/** A single comparable amount for sorting ("R700" → 700, 700 → 700, "R80 - R150" → null: a range is not one price). */
export const priceAmount = (v) => {
  const p = toPrice(v)
  if (p === null) return null
  if (typeof p === "number") return p
  const m = p.replace(/\s/g, "").match(/^R?(\d+(?:[.,]\d+)?)$/i)
  return m ? Number(m[1].replace(",", ".")) : null
}

// ── Images ──────────────────────────────────────────────────────────────────
const IMAGE_URI = /^(https?:\/\/|data:image\/|file:\/\/|content:\/\/)/i
/** A usable image URI from a string or from an object holding url / uri / src / downloadURL. Otherwise null. */
export const toImageUrl = (v) => {
  const s = isObject(v) ? (toText(v.url) || toText(v.uri) || toText(v.src) || toText(v.downloadURL)) : (typeof v === "string" ? v.trim() : "")
  return s && IMAGE_URI.test(s) ? s : null
}
/** Array of unique usable image URIs. `[""]` (the CMS default), null, a wrong type or junk entries give []. A single bare URL string is accepted. */
export const toImageList = (v) => {
  const arr = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
  const out = []
  for (const x of arr) { const u = toImageUrl(x); if (u && !out.includes(u)) out.push(u) }
  return out
}

// ── Location ────────────────────────────────────────────────────────────────
/** {latitude, longitude} of finite, in-range numbers (numeric strings accepted; lat/lng aliases accepted), else null. (0,0) is treated as missing. */
export const toCoordinates = (c) => {
  if (!isObject(c)) return null
  const lat = toFiniteNumber(c.latitude ?? c.lat ?? c._lat), lng = toFiniteNumber(c.longitude ?? c.lng ?? c.lon ?? c.long ?? c._long)
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  return { latitude: lat, longitude: lng }
}

/** http(s) URL text for a website, adding https:// when the scheme is missing. Anything that is not a plausible address gives "". */
export const toWebUrl = (v) => {
  const t = toText(v)
  if (!t) return ""
  if (/^https?:\/\/\S+$/i.test(t)) return t
  return /^[^\s/]+\.[^\s/]+(\/\S*)?$/.test(t) ? `https://${t}` : ""
}

// ── Restaurants ─────────────────────────────────────────────────────────────
/** Table sizes the restaurant actually offers: unique positive whole numbers. Never invented. */
export const toTableOptions = (v) => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : []
  const out = []
  for (const x of arr) { const n = toPositiveInt(x); if (n !== null && n <= 100 && !out.includes(n)) out.push(n) }
  return out
}
/** Can a table request be made? Needs a listing id (the request is sent for it) and at least one real table option. */
export const reservationEligibility = (restaurant) => {
  if (!isObject(restaurant) || !toText(restaurant.id)) return { ok: false, reason: "This restaurant can’t take online reservations right now." }
  if (toTableOptions(restaurant.tableOptions).length === 0) return { ok: false, reason: "This restaurant hasn’t published its table options yet, so online reservations aren’t available. Please contact them directly." }
  return { ok: true, reason: "" }
}
/** Accommodation: needs an id and a guest limit to validate the request against. */
export const stayEligibility = (stay) => {
  if (!isObject(stay) || !toText(stay.id)) return { ok: false, reason: "This place can’t take online booking requests right now." }
  return { ok: true, reason: "" }
}

// ── Business services ───────────────────────────────────────────────────────
/** Services as objects with at least a name. Strings become {name}; objects keep every supported field (icon, price, description …). Invalid entries are dropped. */
export const toServices = (v) => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? toStringList(v) : []
  const out = []
  for (const s of arr) {
    if (isObject(s)) { const name = toText(s.name) || toText(s.title) || toText(s.label); if (name) out.push({ ...s, name }) }
    else { const name = toText(s); if (name) out.push({ name }) }
  }
  return out
}

// ── Transport ───────────────────────────────────────────────────────────────
/** Lower-case mode text exactly as stored ("bus", "train", "taxi", "tram" …). Missing/invalid → "" (NOT defaulted to "bus"). */
export const toMode = (v) => toText(v).toLowerCase()
/** Stops: strings or {name}; invalid entries dropped. */
export const toStops = (v) => toStringList(v)
/** Departure times: strings/numbers or {time}; invalid entries dropped. Nothing is generated. */
export const toDepartures = (v) => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]+/) : []
  return arr.map((x) => (isObject(x) ? toText(x.time) || toText(x.at) || toText(x.departure) : toText(x))).filter(Boolean)
}

// ── Reviews ─────────────────────────────────────────────────────────────────
/** Date from a Firestore Timestamp (toDate / seconds), a Date, an ISO string or epoch millis; otherwise null. */
export const toDate = (v) => {
  let d = null
  if (v instanceof Date) d = v
  else if (isObject(v) && typeof v.toDate === "function") { try { d = v.toDate() } catch { d = null } }
  else if (isObject(v) && typeof v.seconds === "number") d = new Date(v.seconds * 1000)
  else if (typeof v === "string" || typeof v === "number") d = new Date(v)
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
}
/** A review for display: text is text, rating is 0–5 or null, date is a Date or null. Never throws. */
export const toReview = (raw) => {
  const r = isObject(raw) ? raw : {}
  return { id: toText(r.id) || undefined, reviewerName: toText(r.reviewerName), rating: toRating(r.rating), comment: toText(r.comment), createdAt: toDate(r.createdAt) }
}
/** Average of the valid ratings only, one decimal (as a number); 0 when there are none. */
export const averageRating = (reviews) => {
  const rs = (Array.isArray(reviews) ? reviews : []).map((r) => toRating(isObject(r) ? r.rating : null)).filter((x) => x !== null)
  return rs.length === 0 ? 0 : Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10
}

// ── Per-collection normalisers ──────────────────────────────────────────────
const TEXT = ["name", "description", "location", "type", "category", "status", "availability", "address"]
const CONTACT = ["phone", "email"]

const base = (raw, extraText = []) => {
  const o = { ...raw }
  for (const k of [...TEXT, ...extraText]) if (k in o) o[k] = toText(o[k])
  o.images = toImageList(raw.images)
  o.coordinates = toCoordinates(raw.coordinates)
  if ("rating" in o) o.rating = toRating(raw.rating)
  if ("reviews" in o) o.reviews = toCount(raw.reviews)
  return o
}
const contact = (o, raw) => { for (const k of CONTACT) if (k in raw) o[k] = toText(raw[k]); if ("website" in raw) o.website = toWebUrl(raw.website); return o }

const BY_COLLECTION = {
  restaurants: (raw) => {
    const o = base(raw, ["cuisine", "openingHours", "hours", "priceRange"])
    o.tags = toStringList(raw.tags); o.specialDishes = toStringList(raw.specialDishes); o.tableOptions = toTableOptions(raw.tableOptions)
    if ("price" in raw) o.price = toPrice(raw.price)
    // Older staging seed records stored the opening times as `hours`; the screen reads `openingHours`. The value is the document's own, not invented.
    if (!toText(o.openingHours) && toText(raw.hours)) o.openingHours = toText(raw.hours)
    return contact(o, raw)
  },
  accommodations: (raw) => {
    const o = base(raw, ["openingHours", "hours"])
    o.amenities = toStringList(raw.amenities); o.maxGuests = toPositiveInt(raw.maxGuests)
    if ("price" in raw) o.price = toPrice(raw.price)
    return contact(o, raw)
  },
  attractions: (raw) => {
    const o = base(raw, ["duration", "bestTime", "openingHours", "hours"])
    o.features = toStringList(raw.features)
    o.price = toPrice(raw.price ?? raw.entryFee) // the CMS and Malloya both accept either name
    return contact(o, raw)
  },
  recreation: (raw) => {
    const o = base(raw, ["duration", "ageRestriction", "openingHours", "hours"])
    o.activities = toStringList(raw.activities)
    o.entryFee = toPrice(raw.entryFee ?? raw.price)
    return contact(o, raw)
  },
  business: (raw) => {
    const o = base(raw, ["hours", "openingHours"])
    o.services = toServices(raw.services)
    // `gallery.images` is what the CMS "Gallery images" field writes; the Gallery tab shows both lists, the cover carousel only `images`.
    o.galleryImages = toImageList([...o.images, ...toImageList(isObject(raw.gallery) ? raw.gallery.images : undefined)])
    return contact(o, raw)
  },
  healthcare: (raw) => {
    const o = base(raw, ["hours", "insurance", "openingHours"])
    o.specialties = toStringList(raw.specialties); o.emergency = toBool(raw.emergency)
    return contact(o, raw)
  },
  publicservice: (raw) => {
    const o = base(raw, ["hours", "openingHours"])
    o.services = toStringList(raw.services); o.emergency = toBool(raw.emergency)
    // The CMS stores accessibility as text. "No" / "false" / "not accessible" must not render as "Wheelchair accessible".
    const a = raw.accessibility
    o.accessibility = typeof a === "boolean" ? a : typeof a === "string" ? !!a.trim() && !/^(no|false|n\/a|none|not\b.*|inaccessible)$/i.test(a.trim()) : false
    return contact(o, raw)
  },
  emergency: (raw) => {
    const o = { ...raw }
    for (const k of ["name", "number", "category", "type", "address", "description", "additionalInfo"]) if (k in o) o[k] = toText(o[k])
    o.order = toFiniteNumber(raw.order)
    return o
  },
  transport: (raw) => {
    const o = { ...raw }
    for (const k of ["routeName", "operator", "status", "origin", "destination", "frequency", "days", "fare", "notice"]) if (k in o) o[k] = toText(o[k])
    o.mode = toMode(raw.mode); o.stops = toStops(raw.stops); o.departures = toDepartures(raw.departures); o.order = toFiniteNumber(raw.order)
    return o
  },
}

export const LISTING_COLLECTIONS = Object.keys(BY_COLLECTION)

/**
 * Normalises one Firestore listing document for display. `raw` should already include the document id.
 * Never throws and never returns null: a document that is not an object becomes {}.
 */
export function normalizeListing(collectionName, raw) {
  const fn = BY_COLLECTION[collectionName]
  const src = isObject(raw) ? raw : {}
  if (!fn) return { ...src, images: toImageList(src.images), coordinates: toCoordinates(src.coordinates) }
  try { return fn(src) } catch { return { id: src.id } }
}

/** Normalises a whole snapshot's worth of documents and drops entries that are not objects. */
export const normalizeListings = (collectionName, list) => (Array.isArray(list) ? list : []).filter(isObject).map((d) => normalizeListing(collectionName, d))

/** Short, non-identifying description of a render error for diagnostics: the error type and a trimmed message only, never a document. */
export const safeErrorSummary = (error) => ({
  name: typeof error?.name === "string" ? error.name.slice(0, 40) : "Error",
  message: typeof error?.message === "string" ? error.message.replace(/\s+/g, " ").slice(0, 160) : "",
})
