"use strict"
// Grounding validator: runs on EVERY model answer before it reaches the user. The model's JSON is treated as an untrusted
// proposal. We keep only what the turn's tool evidence supports:
//   * block labels are re-derived: "verified" needs cited platform evidence, "knowledge" needs cited knowledge-base evidence
//   * rand amounts and clock times must appear in the cited evidence, otherwise the sentence is removed
//   * availability claims, booking confirmations and travel-time claims are never allowed (the assistant cannot know or do them)
//   * named listings must have been returned by a tool this turn
//   * cards and booking offers are limited to evidence refs and are rebuilt from the database by the caller (never from model text)
// Counts of what was changed are returned (never the removed text) so tests and monitoring can see the validator working.
const { BLOCK_TYPES } = require("./constants")
const { sanitizeText, normalizeName } = require("./sanitize")
const { DISTANCE_NOTE } = require("./geo")

const PLATFORM_KINDS = new Set(["listing", "event", "announcement", "news", "emergency", "transport", "loadshedding"])
const MAX_BLOCKS = 6, MAX_BLOCK_CHARS = 1200, MAX_CARDS = 6

const RE = {
  rand: /(?:\bR\s?\d[\d ,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:rand|zar)\b)/gi,
  clock: /\b(?:[01]?\d|2[0-3])[:h][0-5]\d\b|\b(?:1[0-2]|[1-9])\s?(?:am|pm)\b|\b24\s?(?:hours|hrs|\/7)\b|\bopen(?:s)?\s+(?:at|from)\s+\d{1,2}\b|\b(?:until|till|closes?\s+at)\s+\d{1,2}\b/gi,
  availability: /\b(?:is|are|still|currently|now)\s+(?:available|vacant|open for booking)\b|\b(?:has|have|with)\s+(?:rooms?|tables?|space|vacanc\w+|availability)\s*(?:available|free|left)?\b|\b(?:fully|completely)\s+booked\b|\bbooked\s+out\b|\bsold\s+out\b|\bno\s+vacanc\w+\b|\bavailable\s+(?:tonight|today|tomorrow|this\s+(?:weekend|week)|on\s+\w+day)\b|\bwalk-?ins?\s+(?:are\s+)?(?:welcome|accepted|available)\b/i,
  booking: /\b(?:i(?:'ve|\s+have|'ll|\s+will)?\s+(?:booked|reserved|confirmed|secured|made\s+(?:a|the|your)\s+(?:booking|reservation))|i(?:'ll|\s+will)\s+book|(?:your|the)\s+(?:booking|reservation|table|room|spot|request)\s+(?:is|has\s+been|was|got)\s+(?:now\s+)?(?:confirmed|booked|made|reserved|secured|accepted|approved)|booking\s+(?:is\s+)?(?:now\s+)?confirmed|you(?:'re|\s+are)\s+(?:all\s+)?(?:booked|set|confirmed)|consider\s+it\s+(?:booked|done))\b/i,
  travelTime: /\b\d+(?:[.,]\d+)?\s*(?:-\s*\d+\s*)?(?:min(?:ute)?s?|hours?|hrs?)\s*(?:\w+\s+){0,2}(?:drive|driving|walk|walking|ride|away|by\s+(?:car|taxi|bus|train|foot|uber|bolt)|travel|trip|journey)\b|\b(?:drive|walk|ride|trip|journey|travel)\s+(?:time\s+)?(?:of|is|takes?|about|around)\s+(?:about\s+|around\s+)?\d+\s*(?:min|hour|hr)/i,
}
const BOOKING_SAFE = "I can't make or confirm bookings. If the listing accepts them, you can send a booking request from its page in the app, and the provider will accept or decline it."
const NO_ANSWER = "I couldn't confirm that from XploreSoweto's information, so I'd rather not guess. You could ask me about listings, events, news or emergency contacts that are on the platform."

const splitSentences = (t) => String(t).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
const toNum = (s) => { const n = parseFloat(String(s).replace(/[^\d.]/g, "").replace(/\.(?=.*\.)/g, "")); return Number.isFinite(n) ? n : null }
const randsIn = (t) => (String(t).match(RE.rand) || []).map(toNum).filter((n) => n !== null)
// clock tokens -> the set of hours (0-23) they mention; evidence like "Mon-Fri 9-5" has bare numbers, so any bare number 0..24 in evidence counts (and its 12h complement)
function hoursFromClaim(t) {
  const out = new Set(), s = String(t).toLowerCase()
  for (const m of s.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g)) out.add(+m[1])
  for (const m of s.matchAll(/\b(1[0-2]|[1-9])\s?(am|pm)\b/g)) out.add(m[2] === "pm" ? (+m[1] % 12) + 12 : +m[1] % 12)
  for (const m of s.matchAll(/\b(?:at|from|until|till)\s+(\d{1,2})\b/g)) out.add(+m[1] % 24)
  return out
}
function evidenceHours(texts) {
  const out = new Set()
  for (const t of texts) {
    const s = String(t || "").toLowerCase()
    if (/24\s?(hours|hrs|\/7)|all day|always open/.test(s)) out.add("24")
    for (const m of s.matchAll(/\b([01]?\d|2[0-4])\b(?![.,]\d)/g)) { const h = +m[1]; out.add(h % 24); out.add((h % 12) + 12); out.add(h % 12) }
  }
  return out
}
const claimsOk24 = (claim, ev) => !/\b24\s?(?:hours|hrs|\/7)\b/i.test(claim) || ev.has("24")

function parseModelOutput(text) {
  if (typeof text !== "string") return null
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  const a = s.indexOf("{"), b = s.lastIndexOf("}")
  if (a < 0 || b <= a) return null
  try { const o = JSON.parse(s.slice(a, b + 1)); return o && typeof o === "object" && !Array.isArray(o) ? o : null } catch { return null }
}

// evidence: Map ref -> evidence record (collected from this turn's successful tool results only)
function validateAnswer(raw, { evidence, cfg, bookable = new Set(), detectedLanguage = "en", hasDistance = false }) {
  const report = { strippedSentences: 0, downgradedBlocks: 0, droppedCards: 0, droppedMentions: 0, droppedOffers: 0, bookingSanitised: false, parseFailed: false }
  const out = parseModelOutput(typeof raw === "string" ? raw : null)
  if (!out) {
    report.parseFailed = true
    // A non-JSON reply is still shown, but only as clearly-labelled general text and still passed through the sentence filters.
    const plain = typeof raw === "string" ? sanitizeText(raw, MAX_BLOCK_CHARS) : ""
    return finish([{ type: "general", text: plain, refs: [] }], [], [], [], report, evidence, cfg, bookable, detectedLanguage, hasDistance, null)
  }
  const mentions = (Array.isArray(out.mentions) ? out.mentions : []).filter((m) => typeof m === "string").slice(0, 20)
  const known = [...evidence.values()].map((e) => normalizeName(e.name)).filter(Boolean)
  const badNames = []
  for (const m of mentions) {
    const n = normalizeName(m)
    if (!n) continue
    if (!known.some((k) => k === n || k.includes(n) || n.includes(k))) { badNames.push(n); report.droppedMentions++ }
  }
  const blocks = (Array.isArray(out.blocks) ? out.blocks : []).slice(0, MAX_BLOCKS).map((b) => ({
    type: b && BLOCK_TYPES.includes(b.type) ? b.type : "general",
    text: sanitizeText(b && b.text, MAX_BLOCK_CHARS),
    refs: (Array.isArray(b && b.refs) ? b.refs : []).filter((r) => typeof r === "string" && evidence.has(r)).slice(0, 8),
    badNames,
  }))
  const cards = (Array.isArray(out.cards) ? out.cards : []).filter((r) => typeof r === "string")
  const offers = (Array.isArray(out.bookingOffers) ? out.bookingOffers : []).filter((r) => typeof r === "string")
  const followUps = (Array.isArray(out.followUps) ? out.followUps : []).filter((f) => typeof f === "string").map((f) => sanitizeText(f, 90)).filter(Boolean).slice(0, 3)
  return finish(blocks, cards, offers, followUps, report, evidence, cfg, bookable, detectedLanguage, hasDistance, out.language)
}

function finish(blocks, cardsIn, offersIn, followUps, report, evidence, cfg, bookable, detectedLanguage, hasDistance, modelLanguage) {
  const allEv = [...evidence.values()]
  const unionRands = new Set(allEv.flatMap((e) => [...(e.priceNumbers || []), ...randsIn(`${e.priceText || ""} ${e.descText || ""}`)]))
  const out = []
  for (const b of blocks) {
    let { type } = b
    const cited = b.refs.map((r) => evidence.get(r)).filter(Boolean)
    // 1. labels must be earned
    if (type === "verified" && !cited.some((e) => PLATFORM_KINDS.has(e.kind))) { type = "general"; report.downgradedBlocks++ }
    if (type === "knowledge" && !cited.some((e) => e.kind === "kb")) { type = "general"; report.downgradedBlocks++ }
    const scope = cited.length ? cited : allEv
    const okRands = cited.length ? new Set(cited.flatMap((e) => [...(e.priceNumbers || []), ...randsIn(`${e.priceText || ""} ${e.descText || ""}`)])) : unionRands
    const okHours = evidenceHours(scope.map((e) => [e.hoursText, e.descText, e.dateText, e.timeText].filter(Boolean).join(" ")))
    const kept = []
    for (const s of splitSentences(b.text)) {
      const nm = normalizeName(s)
      if (RE.booking.test(s)) { report.bookingSanitised = true; report.strippedSentences++; continue }
      if (RE.availability.test(s) || RE.travelTime.test(s)) { report.strippedSentences++; continue }
      if (b.badNames.some((n) => nm.includes(n))) { report.strippedSentences++; continue }
      const rands = randsIn(s)
      if (rands.some((n) => !okRands.has(n))) { report.strippedSentences++; continue }
      const claims = s.match(RE.clock) || [] // String.match with a /g regex returns every match and resets lastIndex
      if (claims.length) {
        const hrs = [...hoursFromClaim(claims.join(" "))]
        if (!claims.every((c) => claimsOk24(c, okHours)) || hrs.some((h) => !okHours.has(h))) { report.strippedSentences++; continue }
      }
      kept.push(s)
    }
    if (kept.length) {
      const sources = type === "knowledge" ? [...new Set(cited.filter((e) => e.kind === "kb").map((e) => e.sourceTitle).filter(Boolean))] : []
      out.push({ type, text: kept.join(" "), refs: b.refs, ...(sources.length ? { sources } : {}) })
    }
  }
  if (report.bookingSanitised) out.push({ type: "general", text: BOOKING_SAFE, refs: [] })
  if (!out.length) out.push({ type: "unverified", text: NO_ANSWER, refs: [] })

  const cardOk = (r) => { const e = evidence.get(r); return !!e && (e.kind === "listing" || e.kind === "event") }
  const cards = [...new Set(cardsIn)].filter((r) => { const ok = cardOk(r); if (!ok) report.droppedCards++; return ok }).slice(0, MAX_CARDS)
  const bookingOffers = [...new Set(offersIn)].filter((r) => { const ok = bookable.has(r) && cardOk(r); if (!ok) report.droppedOffers++; return ok }).slice(0, 3)
  const lang = typeof modelLanguage === "string" && cfg.languages[modelLanguage] && cfg.languages[modelLanguage].enabled ? modelLanguage : detectedLanguage
  const distanceNote = hasDistance || cards.some((r) => evidence.get(r) && evidence.get(r).approxKm != null) ? DISTANCE_NOTE : null
  return { language: lang, blocks: out, cards, bookingOffers, followUps, distanceNote, report }
}

module.exports = { validateAnswer, parseModelOutput, BOOKING_SAFE, NO_ANSWER, RE }
