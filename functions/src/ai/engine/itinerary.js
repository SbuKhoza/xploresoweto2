"use strict"
// Itinerary builder: arranges ALREADY-RETRIEVED, ranked records into half-day, full-day or multi-day suggestions.
// Pure: no database access, no clock, no randomness. The same inputs always give the same itinerary.
// What it deliberately does NOT do (the data does not exist): it never states travel times, never verifies that a place is open at the
// chosen slot, never sums activity durations, and never claims an itinerary is "feasible". It says what is unverified instead.
const { approxKm, DISTANCE_NOTE } = require("../geo")

const MAX_DAYS = 5
const TEMPLATES = {
  half_day: [{ slot: "morning", kind: "activity" }, { slot: "midday", kind: "meal" }],
  full_day: [{ slot: "morning", kind: "activity" }, { slot: "midday", kind: "meal" }, { slot: "afternoon", kind: "activity" }],
  multi_day: [{ slot: "morning", kind: "activity" }, { slot: "midday", kind: "meal" }, { slot: "afternoon", kind: "activity" }],
}
const stopOf = (entry, slot, kind) => {
  const m = entry.item.model
  return { slot, kind, ref: entry.item.ref, collection: entry.item.collection, id: entry.item.id, name: m.name, category: m.category, priceText: m.price, priceKnown: m.priceKnown, priceMin: entry.item.price.known ? entry.item.price.min : null,
    hoursText: m.hours, openNow: m.openNow, address: m.address, approxKmFromPrevious: null, reasons: entry.reasons, flags: entry.flags, coords: entry.item.coords, evidence: entry.item.evidence }
}

// pools: { activity: [ranked...], meal: [ranked...], stay: [ranked...] }  (ranked entries come from ranking.rank)
function buildItinerary({ duration, budget, party, pools, interests = [] }) {
  const assumptions = [], caveats = [], missing = [], adjustments = []
  let kind = duration ? duration.kind : null
  if (!kind) { kind = "full_day"; assumptions.push("No length of visit was given, so I planned a single day.") }
  let dayCount = kind === "multi_day" ? Math.min(MAX_DAYS, Math.max(2, Math.ceil(duration.days))) : 1
  if (kind === "multi_day" && duration.days > MAX_DAYS) assumptions.push(`I planned the first ${MAX_DAYS} days; ask me to continue for the rest.`)
  const template = TEMPLATES[kind]
  const used = new Set()
  const take = (pool) => { const e = (pool || []).find((x) => !used.has(x.item.ref)); if (e) used.add(e.item.ref); return e }

  const days = []
  for (let d = 1; d <= dayCount; d++) {
    const stops = []
    for (const t of template) {
      const e = take(t.kind === "meal" ? pools.meal : pools.activity)
      if (!e) { const m = t.kind === "meal" ? "meal" : "activity"; if (!missing.includes(m)) missing.push(m); continue }
      stops.push(stopOf(e, t.slot, t.kind))
    }
    days.push({ day: d, stops })
  }

  // keep within a stated budget using only LISTED prices; unknown prices are never treated as free
  const budgetMax = budget ? budget.max : null
  const cost = () => days.flatMap((x) => x.stops).reduce((n, s) => n + (s.priceMin || 0), 0)
  if (budgetMax != null) {
    for (;;) {
      if (cost() <= budgetMax) break
      const all = days.flatMap((x, di) => x.stops.map((s, si) => ({ s, di, si }))).filter((x) => x.s.priceMin)
      if (days.flatMap((x) => x.stops).length <= 1 || !all.length) break
      all.sort((a, b) => b.s.priceMin - a.s.priceMin)
      const top = all[0]
      days[top.di].stops.splice(top.si, 1)
      adjustments.push(`Removed ${top.s.name} (listed ${top.s.priceText}) to stay within your R${budgetMax} budget.`)
    }
  }
  const stopsAll = days.flatMap((x) => x.stops)
  const unknownPrice = stopsAll.filter((s) => !s.priceKnown)
  const total = cost()

  // straight-line gaps between consecutive stops (approximate; only when both records have coordinates)
  let anyDistance = false
  for (const day of days) day.stops.forEach((s, i) => { const p = day.stops[i - 1]; if (p && p.coords && s.coords) { s.approxKmFromPrevious = approxKm(p.coords, s.coords); anyDistance = true } })

  caveats.push("I can't verify travel times between stops, so check how long each leg will take before you go.")
  const hoursUnverified = stopsAll.filter((s) => s.openNow === "unknown" || !s.hoursText).map((s) => s.name)
  if (hoursUnverified.length) caveats.push(`Opening hours could not be checked for: ${hoursUnverified.join(", ")}. Please confirm before you go.`)
  if (unknownPrice.length) caveats.push(`No price is listed for: ${unknownPrice.map((s) => s.name).join(", ")}, so their cost is not in the total.`)
  if (stopsAll.some((s) => s.priceKnown)) caveats.push("Listed prices are added up as shown; the listings do not say whether a price is per person or per group.")
  if (budget && party && party.total > 1 && budget.kind === "total") caveats.push(`Your budget is for ${party.total} people; if the listed prices are per person, multiply them by ${party.total}.`)
  if (!stopsAll.length) caveats.push("No suitable records were found, so there is nothing to schedule.")

  const stay = dayCount > 1 ? (pools.stay || [])[0] : null
  return {
    kind, dayCount, days: days.map((x) => ({ day: x.day, stops: x.stops.map(({ coords, evidence, ...s }) => s) })),
    stay: stay ? { ref: stay.item.ref, name: stay.item.model.name, priceText: stay.item.model.price, reasons: stay.reasons } : null,
    totals: { knownCostMin: total, unknownPriceCount: unknownPrice.length, budgetMax, withinBudget: budgetMax == null ? null : total <= budgetMax },
    assumptions, caveats, missing, adjustments, feasibility: "unverified", distanceNote: anyDistance ? DISTANCE_NOTE : null,
    evidence: [...stopsAll.map((s) => s.evidence), ...(stay ? [stay.item.evidence] : [])], interests,
  }
}
module.exports = { buildItinerary, MAX_DAYS }
