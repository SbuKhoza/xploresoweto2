// Shared design tokens + helpers for the Xplore list screens.
// Values mirror tailwind.config.js and the Restaurants screen.

export const TEAL  = "#1B4D5C"
export const BRAND = "#E8600A"
export const INK   = "#14213D"
export const MUTED = "#7A8A8F"
export const STAR  = "#F5A524"
export const ALL   = "__all__" // "See All" — no category filter

export const SUCCESS = "#22C55E"
export const WARNING = "#F59E0B"
export const DANGER  = "#EF4444"

// Hero artwork (already used on Home) — 1042 × 316
export const HERO_IMAGE  = require("../../../assets/home/hero-towers.png")
export const HERO_RATIO  = 1042 / 316
export const HERO_BODY_H = 172 // hero height below the status bar

export const cardShadow = {
  shadowColor: INK,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.09,
  shadowRadius: 16,
  elevation: 4,
}
export const softShadow = {
  shadowColor: TEAL,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 10,
  elevation: 3,
}

// Rotating tile colours (same scheme as the rest of the app)
export const TILE_THEMES = [
  { bgClass: "bg-teal-light",    hex: "#1B4D5C" },
  { bgClass: "bg-brand-light",   hex: "#E8600A" },
  { bgClass: "bg-success-light", hex: "#22C55E" },
  { bgClass: "bg-warning-light", hex: "#F59E0B" },
  { bgClass: "bg-danger-light",  hex: "#EF4444" },
]

// ── Category icons ───────────────────────────────────────────────────────────
// Picks a MaterialCommunityIcons glyph from whatever category names exist in
// Firestore. First matching rule wins; `fallback` is used when nothing matches.
const ICON_RULES = [
  // food & drink
  [/caf[eé]|coffee|bakery|\btea\b/,                         "coffee"],
  [/\bfast\b|takeaway|take-away|burger/,                    "hamburger"],
  [/grill|braai|bbq|barbe|steak|shisa/,                     "grill"],
  [/\bbars?\b|\bpubs?\b|lounge|cocktail|tavern|shebeen|night/, "glass-cocktail"],
  [/pizza|italian/,                                         "pizza"],
  [/fine|dining|restaurant/,                                "silverware-fork-knife"],
  // public services (before generic "home"/"office")
  [/home affairs|licen[cs]e|document/,                      "file-document"],
  [/police|saps|\bsafety\b|security/,                       "police-badge"],
  [/\bfire\b|rescue/,                                       "fire-truck"],
  [/librar/,                                                "library"],
  [/school|educat|college|universit|training/,              "school"],
  [/\bpost\b|postal|\bmail\b/,                              "post"],
  [/municipal|government|council|civic|\boffice\b/,         "office-building"],
  [/communit|social|\bngo\b|welfare|youth/,                 "account-group"],
  // health
  [/hospital|emergency|trauma|casualty/,                    "hospital-building"],
  [/pharm|chemist/,                                         "pill"],
  [/dent/,                                                  "tooth"],
  [/\beye\b|optic/,                                         "eye"],
  [/clinic|doctor|\bgp\b|medical|health|practice/,          "stethoscope"],
  // stay
  [/camp|\btent|caravan/,                                   "tent"],
  [/hotel|lodge|resort|\binn\b|guest|b&b|\bbnb\b|bed and|hostel|backpack/, "bed"],
  [/apartment|\bflats?\b|\bhouses?\b|\bhomes?\b|villa|self.?catering|airbnb|cottage/, "home-city"],
  // attractions
  [/museum|heritage|histor|monument|memorial|landmark|castle/, "bank"],
  [/church|cathedral|religio|mosque|temple/,                "church"],
  [/\barts?\b|gallery|cultur|craft|market/,                 "palette"],
  [/\bparks?\b|nature|garden|reserve|outdoor|hik/,          "tree"],
  [/tour|adventure|bungee|tower/,                           "map-marker-radius"],
  // recreation
  [/soccer|football|stadium/,                               "soccer"],
  [/\bgym\b|fitness|workout/,                               "dumbbell"],
  [/basket/,                                                "basketball"],
  [/swim|\bpools?\b|\bwater/,                               "swim"],
  [/cycl|\bbike/,                                           "bike"],
  [/\brunning\b|athlet/,                                    "run"],
  [/tennis|golf|sport|recreation|\bcourt|\bfield/,          "tennis"],
  // business
  [/construct|build|plumb|electric|repair|mechanic|\bauto|motor|garage/, "hammer-wrench"],
  [/salon|\bhair|beauty|barber/,                            "content-cut"],
  [/retail|\bshop|store|grocery|supermarket/,               "storefront"],
  [/finance|\bbank|account|insur|legal|\blaw\b/,            "briefcase"],
  [/\btech|software|digital|print|media|\bit\b/,            "laptop"],
]

export const typeIconFor = (type = "", fallback = "shape") => {
  const t = String(type).toLowerCase()
  for (const [re, icon] of ICON_RULES) if (re.test(t)) return icon
  return fallback
}

// ── Opening hours ────────────────────────────────────────────────────────────
// "09:00 – 23:00" / "9:00 AM - 5:00 PM" → minutes since midnight
const to24 = (h, m, mer) => {
  let hh = Number(h)
  if (mer) {
    const x = mer.toLowerCase()
    if (x === "pm" && hh < 12) hh += 12
    if (x === "am" && hh === 12) hh = 0
  }
  return hh * 60 + Number(m)
}
export const parseHours = (str) => {
  if (typeof str !== "string") return null
  const m = str.match(/(\d{1,2})[:.h](\d{2})\s*(am|pm)?\s*(?:–|—|-|to)\s*(\d{1,2})[:.h](\d{2})\s*(am|pm)?/i)
  if (!m) return null
  return { open: to24(m[1], m[2], m[3]), close: to24(m[4], m[5], m[6]) }
}
// true / false, or null when the hours string can't be understood
export const isOpenNow = (str, now) => {
  const p = parseHours(str)
  if (!p) return null
  const cur = now.getHours() * 60 + now.getMinutes()
  if (p.open === p.close) return true
  return p.close > p.open ? cur >= p.open && cur < p.close : cur >= p.open || cur < p.close
}

// ── Badges ───────────────────────────────────────────────────────────────────
// Rules for the editorial badges — derived from each listing's own data.
export const TOP_RATED_MIN_RATING  = 4.7
export const TOP_RATED_MIN_REVIEWS = 10
export const POPULAR_MIN_REVIEWS   = 200

export const getEditorialBadge = (r) => {
  const rating  = Number(r.rating)  || 0
  const reviews = Number(r.reviews) || 0
  if (rating >= TOP_RATED_MIN_RATING && reviews >= TOP_RATED_MIN_REVIEWS)
    return { label: "Top Rated", icon: "star", color: "#6D4AD8" }
  if (reviews >= POPULAR_MIN_REVIEWS)
    return { label: "Popular", icon: "star", color: "#2563EB" }
  return null
}

// Status badge from the listing's `status` / `availability` text, falling back
// to the opening-hours field. `ok` says whether the place is open / available.
export const getStatusBadge = (item, now, hoursKey) => {
  const s = item.status ?? item.availability
  if (typeof s === "string" && s.trim()) {
    const ok = /^(open|available)/i.test(s.trim())
    return { label: s.trim(), color: ok ? SUCCESS : WARNING, dot: true, ok }
  }
  const open = hoursKey ? isOpenNow(item[hoursKey], now) : null
  if (open === true)  return { label: "Open Now", color: SUCCESS,   dot: true, ok: true }
  if (open === false) return { label: "Closed",   color: "#6B7280", dot: true, ok: false }
  return null
}

// Flattens the text fields of a listing so search can look through all of them.
const SEARCH_KEYS = [
  "name", "type", "category", "cuisine", "location", "description",
  "tags", "features", "activities", "services", "amenities", "specialties", "specialDishes",
]
export const searchText = (item) => {
  const parts = []
  for (const k of SEARCH_KEYS) {
    const v = item[k]
    if (Array.isArray(v)) v.forEach(x => parts.push(typeof x === "string" ? x : x?.name))
    else if (typeof v === "string") parts.push(v)
  }
  return parts.filter(Boolean).join(" ").toLowerCase()
}