// Normalises the real aiChat / aiGetConversation payloads for rendering. Only fields the backend returns are used.
export const BLOCK_STYLES = {
  verified:   { label: "From our listings",  icon: "checkmark-circle", tone: "ok" },
  suggestion: { label: "Suggestion",         icon: "bulb-outline",     tone: "info" },
  knowledge:  { label: "Local knowledge",    icon: "book-outline",     tone: "info" },
  unverified: { label: "Not verified",       icon: "alert-circle-outline", tone: "warn" },
  general:    { label: "",                   icon: null,               tone: "plain" },
}
export const blockStyle = (type) => BLOCK_STYLES[type] || BLOCK_STYLES.general

export const normaliseBlocks = (blocks) =>
  (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && typeof b.text === "string" && b.text.trim())
    .map((b) => ({ type: BLOCK_STYLES[b.type] ? b.type : "general", text: b.text, refs: Array.isArray(b.refs) ? b.refs : [] }))

// Card -> display model. Fields absent from the card are omitted, never invented.
export function cardView(c) {
  if (!c || !c.ref) return null
  if (c.unavailable) return { ref: c.ref, unavailable: true, title: "No longer available" }
  const km = Number.isFinite(c.approxKm) ? c.approxKm : null
  return {
    ref: c.ref, kind: c.kind, collection: c.collection || null, id: c.id || null,
    title: c.title || "", subtitle: c.subtitle || "", image: c.image || null, priceText: c.priceText || null,
    rating: Number.isFinite(c.rating) ? c.rating : null, reviewCount: Number.isFinite(c.reviewCount) ? c.reviewCount : null,
    status: c.openNow === true ? "Open now" : c.openNow === false ? "Closed now" : null,
    distance: km === null ? null : `~${km < 10 ? km.toFixed(1) : Math.round(km)} km (straight line)`,
  }
}

// Turns an aiChat response into one assistant chat item.
export function assistantItemFromResponse(r) {
  const cards = (Array.isArray(r?.cards) ? r.cards : []).map(cardView).filter(Boolean)
  const offerRefs = new Set((Array.isArray(r?.bookingOffers) ? r.bookingOffers : []).map((o) => o.ref))
  return {
    role: "assistant", id: r?.messageId || null,
    blocks: normaliseBlocks(r?.blocks), cards,
    bookingOffers: (Array.isArray(r?.bookingOffers) ? r.bookingOffers : []).filter((o) => o && o.ref && cards.some((c) => c.ref === o.ref && !c.unavailable)),
    offerRefs,
    followUps: (Array.isArray(r?.followUps) ? r.followUps : []).filter((f) => typeof f === "string" && f.trim()).slice(0, 3),
    languageNotice: r?.languageNotice || null, distanceNote: r?.distanceNote || null, bookingNote: r?.bookingNote || null,
  }
}

// Stored messages (aiGetConversation): user {text}, assistant {blocks, followUps, cards, ...}.
export function itemsFromConversation(res) {
  return (Array.isArray(res?.messages) ? res.messages : []).map((m, i) => {
    if (m.role === "user") return { role: "user", id: m.id || `u${i}`, text: String(m.text || "") }
    const cards = (Array.isArray(m.cards) ? m.cards : []).map(cardView).filter(Boolean)
    const blocks = normaliseBlocks(m.blocks)
    return { role: "assistant", id: m.id || `a${i}`, blocks: blocks.length ? blocks : normaliseBlocks([{ type: "general", text: m.text }]), cards, bookingOffers: [], followUps: i === res.messages.length - 1 ? (Array.isArray(m.followUps) ? m.followUps.slice(0, 3) : []) : [], languageNotice: null, distanceNote: m.distanceNote || null, bookingNote: null }
  })
}

// Where a card opens in the existing Xplore stack (these screens already hold the listing detail + reservation form).
const COLLECTION_SCREEN = { restaurants: "Restaurants", accommodations: "Accommodation", attractions: "Attraction", recreation: "Recreation", business: "Business", healthcare: "Healthcare", publicservice: "PublicService" }
export const screenForCard = (c) => (c && !c.unavailable ? (c.kind === "event" ? { tab: "Community", screen: "Events" } : COLLECTION_SCREEN[String(c.collection || "").toLowerCase()] ? { tab: "Xplore", screen: COLLECTION_SCREEN[String(c.collection).toLowerCase()] } : null) : null)
