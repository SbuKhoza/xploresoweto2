"use strict"
// Response generation WITHOUT a language model: structured templates filled only with retrieved records.
// Block types tell the app how to label each part:
//   verified    facts that come straight from a stored record (name, listed price, stored hours, rating, address, phone)
//   suggestion  the engine's own ranking, ordering and explanations ("why these", the day plan)
//   knowledge   a passage from the curated township guide, with its source
//   unverified  what could NOT be confirmed or found, assumptions, limits
//   general     only for the national emergency numbers fallback, labelled as not from XploreSoweto records
// Every composer returns { blocks, evidence, bookingOffers, followUps }. `evidence` are the records shown (cards are built from them).
const { cleanQuoted } = require("./safety")
const { sanitizeText } = require("../sanitize")

const block = (type, text, extra = {}) => ({ type, text, refs: [], ...extra })
const out = (blocks, evidence = [], followUps = [], bookingOffers = []) => ({ blocks: blocks.filter((b) => b && b.text), evidence, followUps: followUps.slice(0, 3), bookingOffers })

function factLine(it, L, { distance = true } = {}) {
  const m = it.model, f = L.facts, parts = []
  parts.push(m.priceKnown ? f.price(m.price) : m.price ? f.price(m.price) : f.noPrice)
  parts.push(m.hours ? f.hours(m.hours) : f.noHours)
  parts.push(m.rating !== null ? f.rating(m.rating, m.reviewCount) : f.noRating)
  if (distance && m.approxStraightLineKm !== null) parts.push(f.km(m.approxStraightLineKm))
  return parts.join("; ")
}
const title = (m) => `${m.name}${m.category ? ` (${m.category})` : ""}`

// ---- find / recommend -------------------------------------------------------------------------------------------------------
function composeFind({ L, label, entries, where, relaxed, truncated, scanned, excluded, noLocation, distanceNote, wantsBooking, followUps }) {
  const blocks = [], evidence = []
  if (!entries.length) {
    blocks.push(block("unverified", L.foundNone(label, where)))
  } else {
    blocks.push(block("verified", L.foundIntro(entries.length, label, relaxed ? null : where), { refs: entries.map((e) => e.item.ref) }))
    blocks.push(block("verified", entries.map((e, i) => `${i + 1}. ${title(e.item.model)}${e.item.model.address ? `, ${e.item.model.address}` : ""} — ${factLine(e.item, L)}`).join("\n"), { refs: entries.map((e) => e.item.ref) }))
    const why = entries.slice(0, 3).filter((e) => e.reasons.length).map((e) => `${e.item.model.name}: ${e.reasons.join("; ")}.`)
    if (why.length) blocks.push(block("suggestion", `${L.whyHeader}\n${why.join("\n")}`))
    evidence.push(...entries.map((e) => e.item.evidence))
  }
  if (relaxed && relaxed.terms) blocks.push(block("unverified", L.relaxedTerms(relaxed.terms, label)))
  if (relaxed && relaxed.place) blocks.push(block("unverified", L.relaxedPlace(relaxed.place, label)))
  const ex = Object.entries(excluded || {}).filter(([, n]) => n > 0).map(([k, n]) => L.excluded[k](n))
  if (ex.length) blocks.push(block("unverified", ex.join(" ")))
  if (truncated) blocks.push(block("unverified", L.truncated(scanned)))
  if (noLocation) blocks.push(block("unverified", L.noLocation))
  if (distanceNote && entries.some((e) => e.item.model.approxStraightLineKm !== null)) blocks.push(block("unverified", distanceNote))
  const offers = entries.filter((e) => e.item.evidence.bookable).map((e) => e.item.ref).slice(0, 3)
  if (wantsBooking && offers.length) blocks.push(block("unverified", L.bookingNote))
  return out(blocks, evidence, followUps || [L.follow.details, L.follow.cheaper, L.follow.plan], wantsBooking ? offers : [])
}

// ---- one place --------------------------------------------------------------------------------------------------------------
function composeAsk({ L, item, attributes, ctxLocation, wantsBooking }) {
  const m = item.model, blocks = [], refs = [item.ref]
  const attrs = attributes.size || wantsBooking ? attributes : new Set(["about"])
  if (attrs.has("price")) blocks.push(m.price ? block("verified", L.askPrice(m.name, m.price), { refs }) : block("unverified", L.askNoPrice(m.name)))
  if (attrs.has("hours")) {
    if (m.hours) blocks.push(block("verified", `${L.askHours(m.name, m.hours)} ${L.askOpenNote[m.openNow] || L.askOpenNote.unknown}`, { refs }))
    else blocks.push(block("unverified", L.askNoHours(m.name)))
  }
  if (attrs.has("services")) blocks.push(m.tags.length ? block("verified", L.askServices(m.name, m.tags), { refs }) : block("unverified", L.askNoServices(m.name)))
  if (attrs.has("directions")) {
    blocks.push(block("verified", L.askDirections(m.name, m.address), { refs }))
    blocks.push(block("unverified", [L.directionsHow, m.approxStraightLineKm !== null ? L.directionsKm(m.approxStraightLineKm) : null].filter(Boolean).join(" ")))
  }
  if (attrs.has("about")) {
    const desc = cleanQuoted(m.description || "", 240)
    blocks.push(block("verified", [L.aboutPlace(m.name), `${title(m)}${m.address ? `, ${m.address}` : ""} — ${factLine(item, L)}.`, m.phone ? L.facts.phone(m.phone) + "." : null, desc ? L.askDesc(desc) : null].filter(Boolean).join("\n"), { refs }))
  }
  const bookable = !!item.evidence.bookable
  if (wantsBooking) blocks.push(block("unverified", bookable ? L.bookable(m.name) : L.notBookable(m.name)))
  return out(blocks, [item.evidence], [L.follow.cheaper, L.follow.directions, L.follow.plan], wantsBooking && bookable ? [item.ref] : [])
}

// ---- compare ----------------------------------------------------------------------------------------------------------------
function composeCompare({ L, items }) {
  const blocks = [block("verified", L.compareIntro(items.length), { refs: items.map((i) => i.ref) })]
  blocks.push(block("verified", items.map((it) => `${title(it.model)} — ${factLine(it, L)}`).join("\n"), { refs: items.map((i) => i.ref) }))
  const priced = items.filter((i) => i.price.known), rated = items.filter((i) => i.model.rating !== null)
  const notes = []
  if (priced.length === items.length && items.length >= 2) {
    const sorted = [...priced].sort((a, b) => a.price.min - b.price.min)
    if (sorted[0].price.min < sorted[1].price.min) notes.push(L.compareCheaper(sorted[0].model.name, sorted[0].model.price))
  }
  if (rated.length === items.length && items.length >= 2) {
    const sorted = [...rated].sort((a, b) => b.model.rating - a.model.rating)
    if (sorted[0].model.rating > sorted[1].model.rating) notes.push(L.compareRating(sorted[0].model.name, sorted[0].model.rating))
  }
  blocks.push(notes.length ? block("suggestion", notes.join(" ")) : block("unverified", L.compareNoBasis))
  return out(blocks, items.map((i) => i.evidence), [L.follow.directions, L.follow.plan])
}

// ---- itinerary --------------------------------------------------------------------------------------------------------------
function composePlan({ L, plan, dateLabel }) {
  const blocks = []
  const stops = plan.days.flatMap((d) => d.stops)
  if (!stops.length) return out([block("unverified", L.planNothing), ...plan.caveats.slice(1).map((c) => block("unverified", c))], [], [L.follow.interests, L.follow.stay])
  blocks.push(block("suggestion", [L.planIntro(plan.kind, plan.dayCount, dateLabel), ...plan.assumptions].join(" ")))
  for (const d of plan.days.filter((x) => x.stops.length)) {
    const head = L.dayHeader(d.day, plan.dayCount)
    const lines = d.stops.map((s) => {
      const f = L.facts, bits = [s.priceKnown || s.priceText ? f.price(s.priceText) : f.noPrice, s.hoursText ? f.hours(s.hoursText) : f.noHours]
      if (s.approxKmFromPrevious !== null) bits.push(L.stopKm(s.approxKmFromPrevious))
      return `${L.slot[s.slot]}: ${s.name}${s.category ? ` (${s.category})` : ""} — ${bits.join("; ")}`
    })
    blocks.push(block("suggestion", [head, ...lines].filter(Boolean).join("\n"), { refs: d.stops.map((s) => s.ref) }))
  }
  const t = plan.totals
  blocks.push(t.knownCostMin > 0 || t.budgetMax != null ? block("verified", L.planTotal(t.knownCostMin, t.budgetMax), { refs: stops.map((s) => s.ref) }) : block("unverified", L.planNoCost))
  if (plan.adjustments.length) blocks.push(block("suggestion", plan.adjustments.join(" ")))
  if (plan.missing.length) blocks.push(block("unverified", L.planMissing(plan.missing)))
  if (plan.stay) blocks.push(block("suggestion", L.planStay(plan.stay.name, plan.stay.priceText), { refs: [plan.stay.ref] }))
  blocks.push(block("unverified", plan.caveats.join(" ")))
  if (plan.distanceNote) blocks.push(block("unverified", plan.distanceNote))
  return out(blocks, plan.evidence, [L.follow.party, L.follow.directions, L.follow.cheaper])
}

// ---- knowledge, events, emergency, tours, clarify, static -------------------------------------------------------------------
function composeKnowledge({ L, results }) {
  if (!results.length) return out([block("unverified", L.kbNone)], [], [L.follow.cats, L.follow.plan])
  const sources = [...new Set(results.map((r) => r.source))]
  return out([block("knowledge", `${L.kbIntro}\n${results.map((r) => `${r.title}: ${r.text}`).join("\n")}`, { refs: results.map((r) => r.ref), sources })], [], [L.follow.cats, L.follow.plan])
}
function composeEvents({ L, results, notes }) {
  if (!results.length) return out([block("unverified", L.eventsNone)], [], [L.follow.plan, L.follow.cats])
  return out([block("verified", `${L.eventsIntro(results.length)}\n${results.map((e) => `• ${L.eventLine(e)}`).join("\n")}`, { refs: results.map((e) => e.ref) })], results.map((e) => ({ ref: e.ref, kind: "event", name: e.title, dateText: `${e.date}${e.time ? ` ${e.time}` : ""}`, address: e.location, category: e.category })), [L.follow.plan, L.follow.cats])
}
function composeEmergency({ L, results }) {
  const blocks = results.length
    ? [block("verified", `${L.emergencyIntro}\n${results.map((r) => `• ${r.name}: ${r.number}`).join("\n")}`, { refs: results.map((r) => r.ref) })]
    : [block("general", L.emergencyNone)]
  blocks.push(block("unverified", L.emergencyNote))
  return out(blocks, [], [])
}
function composeTours({ L, what, matches }) {
  if (!matches.length) return out([block("unverified", L.noTourData(what))], [], [L.follow.cats, L.follow.plan])
  return out([block("verified", L.tourIntro(matches.length, what), { refs: matches.map((e) => e.item.ref) }), block("verified", matches.map((e, i) => `${i + 1}. ${title(e.item.model)} — ${factLine(e.item, L)}`).join("\n"), { refs: matches.map((e) => e.item.ref) })], matches.map((e) => e.item.evidence), [L.follow.details])
}
function composeTransport({ L, results, wider }) {
  if (!results.length) return out([block("unverified", L.transportNone)], [], [L.follow.cats, L.follow.plan])
  const blocks = [block("verified", `${L.transportIntro(results.length)}\n${results.map((t) => `• ${L.transportLine(t)}`).join("\n")}`, { refs: results.map((t) => t.ref) })]
  if (wider) blocks.unshift(block("unverified", L.transportWider))
  blocks.push(block("unverified", L.transportNote))
  return out(blocks, [], [L.follow.plan, L.follow.stay])
}
function composeNews({ L, results }) {
  if (!results.length) return out([block("unverified", L.newsNone)], [], [L.follow.plan])
  return out([block("verified", `${L.newsIntro(results.length)}\n${results.map((r) => `• ${L.newsLine(r)}`).join("\n")}`, { refs: results.map((r) => r.ref) })], [], [L.follow.plan])
}
function composeAnnouncements({ L, results }) {
  if (!results.length) return out([block("unverified", L.announcementsNone)], [], [L.follow.plan])
  return out([block("verified", `${L.announcementsIntro(results.length)}\n${results.map((r) => `• ${L.announcementLine(r)}`).join("\n")}`, { refs: results.map((r) => r.ref) })], [], [L.follow.plan])
}
function composeLoadshedding({ L, suburb, data }) {
  if (!data || !data.found) return out([block("unverified", L.loadsheddingNone(suburb))], [], [])
  const lines = Object.entries(data.stages).slice(0, 4).map(([stage, days]) => L.loadsheddingStage(stage, Object.entries(days).map(([d, r]) => `${d} ${r.join(", ") || "none"}`).join("; ")))
  return out([block("verified", [L.loadsheddingIntro(data.suburb), ...lines].join("\n"), { refs: [data.ref] }), block("unverified", L.loadsheddingNote)], [], [])
}
function composeTownships({ L, names }) {
  if (!names.length) return out([block("unverified", L.townshipsNone)], [], [L.follow.cats])
  return out([block("knowledge", `${L.townshipsIntro(names.length)}\n${names.join(", ")}`, { sources: ["XploreSoweto township guide (platform content, authored by XploreSoweto)"] })], [], [L.follow.cats, L.follow.plan])
}
const composeClarify = ({ L, text, followUps }) => ({ ...out([block("unverified", text)], [], followUps || []), clarification: true })
const composeStatic = ({ L, key }) => out([block("verified", L[key])], [], key === "greeting" || key === "help" || key === "unknown" ? [L.follow.cats, L.follow.stay, L.follow.plan] : [])

module.exports = { composeFind, composeAsk, composeCompare, composePlan, composeKnowledge, composeEvents, composeEmergency, composeTours, composeTransport, composeNews, composeAnnouncements, composeLoadshedding, composeTownships, composeClarify, composeStatic, factLine, block }
