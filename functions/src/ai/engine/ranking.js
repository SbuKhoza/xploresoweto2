"use strict"
// Ranking: deterministic and explainable. Every point comes from a named factor and is returned with its reason, so the answer can say
// WHY something was suggested. Rules:
//   * Only facts stored on the record are used. Missing price, rating, hours or location earn 0 points and are flagged: they are never
//     replaced by a guess and never counted as a good or bad value.
//   * No paid placement. Nothing about who owns, pays, subscribes, is "featured", "promoted" or has a "plan" is read here (a test
//     checks both the source and the behaviour). Ties break by name, so identical inputs always give the same order.
const { nm } = require("../retrieval/listings")
const { DISTANCE_NOTE } = require("../geo")

// Explicit, reviewable weights. Change them here (and update the tests) and nowhere else.
const WEIGHTS = Object.freeze({ text: 3, interest: 2, interestCap: 3, rating: 1.5, distance: 1.5, distanceKmZero: 20, budgetFit: 1, place: 2, tag: 1, bayesPriorMean: 3.5, bayesPriorWeight: 5 })
const has = (hay, t) => hay.includes(t)
const STOP = new Set(["the", "a", "an", "and", "or", "in", "at", "to", "of", "for", "with", "near", "me", "is", "are", "what", "where", "can", "i", "do", "find", "show", "soweto", "good", "best", "some", "any", "my", "we", "our", "you"])
const tokens = (s) => nm(s).split(" ").filter((t) => t.length >= 2 && !STOP.has(t))

// interestWords: { history: [...words] } so an interest matches its synonyms in the record's own text.
function scoreItem(item, c) {
  const m = item.model, factors = [], reasons = [], flags = []
  let total = 0
  const add = (key, points, reason) => { if (points) { factors.push({ key, points: Math.round(points * 100) / 100 }); total += points } if (reason) reasons.push(reason) }

  // text relevance (name > category/tags > description)
  const qt = (c.queryTerms || []).flatMap(tokens)
  if (qt.length) {
    let rel = 0, hits = 0
    for (const t of qt) { if (has(item.h.name, t)) { rel += 3; hits++ } else if (has(item.h.cat, t)) { rel += 2; hits++ } else if (has(item.h.desc, t)) { rel += 1; hits++ } }
    if (hits) add("text", (rel / qt.length) * WEIGHTS.text, `matches "${[...new Set(c.queryTerms)].slice(0, 3).join(", ")}"`)
  }
  // interests, using each interest's synonym list
  const matched = []
  for (const [interest, words] of Object.entries(c.interestWords || {})) {
    if (words.some((w) => { const t = nm(w); return t && (has(item.h.cat, t) || has(item.h.desc, t) || has(item.h.name, t)) })) matched.push(interest)
  }
  if (matched.length) add("interest", Math.min(matched.length, WEIGHTS.interestCap) * WEIGHTS.interest, `fits your interest in ${matched.join(" and ")}`)
  // place
  if (c.place && has(item.h.addr, nm(c.place))) add("place", WEIGHTS.place, `in ${c.place}`)
  // budget: a KNOWN price inside the budget is a verified fit; unknown is flagged and neutral; over budget is excluded earlier
  if (c.budgetMax != null) {
    if (item.price.known) { if (item.price.min <= c.budgetMax) add("budget", WEIGHTS.budgetFit, `listed price ${item.price.text} is within your R${c.budgetMax} budget`) }
    else flags.push("price_not_listed")
  }
  // rating: Bayesian average so one 5-star review cannot beat 100 good ones; absent rating = 0 points, flagged
  if (m.rating !== null) {
    const n = m.reviewCount || 0
    const bayes = ((m.rating * n + WEIGHTS.bayesPriorMean * WEIGHTS.bayesPriorWeight) / (n + WEIGHTS.bayesPriorWeight)) / 5
    add("rating", bayes * WEIGHTS.rating, `rated ${m.rating}${n ? ` from ${n} review${n === 1 ? "" : "s"}` : ""}`)
  } else flags.push("no_rating")
  // distance: only with a shared location and stored coordinates; straight-line, approximate
  if (c.useDistance) {
    if (m.approxStraightLineKm !== null) add("distance", Math.max(0, 1 - m.approxStraightLineKm / WEIGHTS.distanceKmZero) * WEIGHTS.distance, `about ${m.approxStraightLineKm} km away in a straight line (approximate)`)
    else flags.push("no_coordinates")
  }
  if (!m.hours) flags.push("hours_not_listed")
  return { item, score: Math.round(total * 1000) / 1000, factors, reasons, flags }
}

// Hard filters. Returns { kept, excluded:{overBudget, notAccessible, closedOrUnknown} }; unknown is only excluded when the user ASKED for the property.
function filterItems(items, c) {
  const excluded = { overBudget: 0, accessibilityUnknown: 0, notAccessible: 0, notOpenNow: 0, hoursUnknown: 0, belowRating: 0 }
  const kept = []
  for (const it of items) {
    const m = it.model
    if (c.budgetMax != null && it.price.known && it.price.min > c.budgetMax) { excluded.overBudget++; continue }
    if (c.minRating != null && m.rating !== null && m.rating < c.minRating) { excluded.belowRating++; continue }
    if (c.accessibleOnly && m.accessible !== true) { m.accessible === null ? excluded.accessibilityUnknown++ : excluded.notAccessible++; continue }
    if (c.openNow && m.openNow !== "open") { m.openNow === "unknown" ? excluded.hoursUnknown++ : excluded.notOpenNow++; continue }
    kept.push(it)
  }
  return { kept, excluded }
}

function rank(items, c) {
  const { kept, excluded } = filterItems(items, c)
  const scored = kept.map((it) => scoreItem(it, c))
  // when the user gave search terms or interests, records with no relevance at all are not candidates (no padding with random places)
  const wantsRelevance = (c.queryTerms || []).length > 0 || Object.keys(c.interestWords || {}).length > 0
  const relevant = wantsRelevance ? scored.filter((s) => s.factors.some((f) => f.key === "text" || f.key === "interest")) : scored
  relevant.sort((a, b) => b.score - a.score || a.item.model.name.localeCompare(b.item.model.name) || a.item.id.localeCompare(b.item.id))
  return { ranked: relevant, excluded, considered: items.length, distanceNote: c.useDistance ? DISTANCE_NOTE : null }
}
module.exports = { rank, scoreItem, filterItems, WEIGHTS, tokens }
