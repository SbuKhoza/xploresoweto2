"use strict"
// Cards shown in the app are built from SERVER-SIDE database records, never from model text, so a card cannot show a listing,
// price or image the database does not hold. Used both when answering and when re-opening a stored conversation (so a listing
// that was suspended after the answer is shown as unavailable instead of stale).
const N = require("./normalize")
const { getVisible } = require("./data")
const { LISTING_COLLECTIONS } = require("../constants")

const cardFromEvidence = (e) => ({ ref: e.ref, kind: e.kind, title: e.name, subtitle: e.kind === "event" ? [e.dateText, e.address].filter(Boolean).join(" · ") : [e.category, e.address].filter(Boolean).join(" · "), image: e.imageUrl || null, priceText: e.priceText || null, rating: e.rating ?? null, reviewCount: e.reviewCount ?? null, openNow: e.kind === "listing" ? e.openStatus : null, approxKm: e.approxKm ?? null, collection: e.collection || (e.kind === "event" ? "events" : null), id: e.id || e.ref.split("/").pop() })
const CARD_KINDS = new Set(["listing", "event"])
async function hydrateRefs(refs, ctx) {
  const out = []
  for (const ref of (refs || []).slice(0, 12)) {
    const m = /^(listing|event):([a-z-]+)\/([A-Za-z0-9_.-]{1,128})$/.exec(String(ref))
    if (!m || (m[1] === "listing" && !LISTING_COLLECTIONS.includes(m[2])) || (m[1] === "event" && m[2] !== "events")) { continue }
    const row = await getVisible(m[2], m[3])
    if (!row) { out.push({ ref, kind: m[1], unavailable: true }); continue }
    if (m[1] === "listing") out.push(cardFromEvidence(N.summarizeListing(m[2], row.id, row.data, ctx).evidence))
    else { const d = row.data, start = N.toMillis(N.pick(d, "date", "startDate", "eventDate")); out.push(cardFromEvidence({ ref, kind: "event", id: row.id, name: String(N.pick(d, "title", "name") || "").slice(0, 120), dateText: Number.isNaN(start) ? "" : N.ymd(start), address: String(N.pick(d, "location", "venue") || "").slice(0, 140), imageUrl: N.firstImage(d) })) }
  }
  return out
}
module.exports = { cardFromEvidence, hydrateRefs, CARD_KINDS }
