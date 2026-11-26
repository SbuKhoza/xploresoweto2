"use strict"
// Itinerary builder: arranges ALREADY-RETRIEVED, ranked records into half-day, full-day or multi-day suggestions.
// Pure: no database access, no clock, no randomness. The same inputs always give the same itinerary.
// What it deliberately does NOT do (the data does not exist): it never states travel times, never verifies that a place is open at the
// chosen slot, never sums activity durations, and never claims an itinerary is "feasible". It says what is unverified instead.
const { approxKm, DISTANCE_NOTE } = require("../geo")
const { stopCost, verdict, people } = require("./cost")

const MAX_DAYS = 5
const TEMPLATES = {
  half_day: [{ slot: "morning", kind: "activity" }, { slot: "midday", kind: "meal" }],
  full_day: [{ slot: "morning", kind: "activity" }, { slot: "midday", kind: "meal" }, { slot: "afternoon", kind: "activity" }],
  multi_day: [{ slot: "morning", kind: "activity" }, { slot: "midday", kind: "meal" }, { slot: "afternoon", kind: "activity" }],
}
const stopOf = (entry, slot, kind) => {
  const m = entry.item.model
  return { slot, kind, ref: entry.item.ref, collection: entry.item.collection, id: entry.item.id, name: m.name, category: m.category, priceText: m.price, priceKnown: m.priceKnown, priceMin: entry.item.price.known ? entry.item.price.min : null, priceMax: entry.item.price.known ? entry.item.price.max : null, priceUnit: entry.item.price.unit || "unknown",
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
  const budgetCap = budget ? budget.max : null
  const costOfEntry = (e, kind) => stopCost({ priceMin: e.item.price.known ? e.item.price.min : null, priceMax: e.item.price.known ? e.item.price.max : null, unit: e.item.price.unit, party, kind })
  let runningHi = 0
  // With a budget, prefer a place whose cost is established to fit (even on the dearest reading) over one that merely ranks higher.
  const take = (pool) => {
    const free = (pool || []).filter((x) => !used.has(x.item.ref))
    const fits = budgetCap == null ? null : free.find((x) => runningHi + costOfEntry(x, "activity").hi <= budgetCap)
    const e = fits || free[0]
    if (e) { used.add(e.item.ref); runningHi += costOfEntry(e, "activity").hi }
    return e
  }

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

  // Costs use LISTED prices and the listed unit for this group. A stop whose unit is not stated keeps a range (whole group .. per person).
  // Budget trimming only removes stops that are over budget even on the CHEAPEST reading; an unclear total is reported, never called affordable.
  const budgetMax = budget ? budget.max : null
  const nights = dayCount > 1 ? dayCount - 1 : 0
  const sum = () => days.flatMap((x) => x.stops).map((st) => st.cost).reduce((a, c) => ({ lo: a.lo + c.lo, hi: a.hi + c.hi }), { lo: 0, hi: 0 })
  for (const d of days) for (const st of d.stops) st.cost = stopCost({ priceMin: st.priceMin, priceMax: st.priceMax, unit: st.priceUnit, party, kind: "activity" })
  if (budgetMax != null) {
    for (;;) {
      if (sum().lo <= budgetMax) break
      const all = days.flatMap((x, di) => x.stops.map((st, si) => ({ st, di, si }))).filter((x) => x.st.cost.lo > 0)
      if (days.flatMap((x) => x.stops).length <= 1 || !all.length) break
      all.sort((a, b) => b.st.cost.lo - a.st.cost.lo)
      const top = all[0]
      days[top.di].stops.splice(top.si, 1)
      adjustments.push(`Removed ${top.st.name} (listed ${top.st.priceText}) because the plan was over your R${budgetMax} budget even at the lowest reading of the prices.`)
    }
  }
  const stopsAll = days.flatMap((x) => x.stops)
  const unknownPrice = stopsAll.filter((s) => !s.priceKnown)
  const stayEntry = dayCount > 1 ? (pools.stay || [])[0] : null
  const stayCost = stayEntry ? stopCost({ priceMin: stayEntry.item.price.known ? stayEntry.item.price.min : null, priceMax: stayEntry.item.price.known ? stayEntry.item.price.max : null, unit: stayEntry.item.price.unit, party, nights, kind: "stay" }) : null
  const stopsTotal = sum()
  const total = { lo: stopsTotal.lo + (stayCost ? stayCost.lo : 0), hi: stopsTotal.hi + (stayCost ? stayCost.hi : 0) }
  const unitUnclear = stopsAll.filter((s) => s.priceKnown && !s.cost.established && s.cost.ambiguousBasis)
  const unpriced = unknownPrice.length + (stayCost && stayCost.noPrice ? 1 : 0)
  const verd = verdict({ lo: total.lo, hi: total.hi, budget: budgetMax, unpriced })

  // straight-line gaps between consecutive stops (approximate; only when both records have coordinates)
  let anyDistance = false
  for (const day of days) day.stops.forEach((s, i) => { const p = day.stops[i - 1]; if (p && p.coords && s.coords) { s.approxKmFromPrevious = approxKm(p.coords, s.coords); anyDistance = true } })

  caveats.push("I can't verify travel times between stops, so check how long each leg will take before you go.")
  const hoursUnverified = stopsAll.filter((s) => s.openNow === "unknown" || !s.hoursText).map((s) => s.name)
  if (hoursUnverified.length) caveats.push(`Opening hours could not be checked for: ${hoursUnverified.join(", ")}. Please confirm before you go.`)
  if (unknownPrice.length) caveats.push(`No price is listed for: ${unknownPrice.map((s) => s.name).join(", ")}, so their cost is not in the total.`)
  if (unitUnclear.length) caveats.push(`The listing does not say whether the price is per person or for the whole group for: ${unitUnclear.map((s) => s.name).join(", ")}. The total shows both readings for ${people(party)} people.`)
  if (stayCost && stayCost.basis === "per_room") assumptions.push(`The stay is priced per room per night; I assumed ${stayCost.rooms} room${stayCost.rooms > 1 ? "s" : ""} for ${people(party)} people.`)
  if (!stopsAll.length) caveats.push("No suitable records were found, so there is nothing to schedule.")

  const stay = stayEntry
  return {
    kind, dayCount, days: days.map((x) => ({ day: x.day, stops: x.stops.map(({ coords, evidence, cost, ...s }) => ({ ...s, costLo: cost.lo, costHi: cost.hi })) })),
    stay: stay ? { ref: stay.item.ref, name: stay.item.model.name, priceText: stay.item.model.price, priceUnit: stay.item.price.unit || "unknown", reasons: stay.reasons, costLo: stayCost.lo, costHi: stayCost.hi } : null,
    party: party && party.total ? party.total : null, nights,
    totals: { knownCostMin: total.lo, costLo: total.lo, costHi: total.hi, unknownPriceCount: unpriced, unitUnclearCount: unitUnclear.length, budgetMax, verdict: verd, withinBudget: budgetMax == null ? null : verd === "within" },
    assumptions, caveats, missing, adjustments, feasibility: "unverified", distanceNote: anyDistance ? DISTANCE_NOTE : null,
    evidence: [...stopsAll.map((s) => s.evidence), ...(stay ? [stay.item.evidence] : [])], interests,
  }
}
module.exports = { buildItinerary, MAX_DAYS }
