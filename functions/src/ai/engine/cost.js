"use strict"
// What a listed price means for THIS group. Pure arithmetic over stored values; nothing is guessed.
//   per_person -> price x people          per_group -> price          free -> 0
//   per_room   -> price x rooms x nights  (rooms = people / 2 rounded up: an ASSUMPTION that is always stated)
//   per_night  -> price x nights, and the listing does not say whether that is per room or per person -> a range
//   unknown    -> a range: the price as it stands (whole group) up to price x people (if it is per person)
// The result is always { lo, hi }: the cheapest and the dearest reading that the stored data still allows. When lo != hi the unit could not be
// established, and the caller must not call the plan affordable unless even `hi` fits.
const people = (party) => (party && Number.isInteger(party.total) && party.total > 0 ? party.total : 1)
const roomsFor = (party) => Math.ceil(people(party) / 2)

function stopCost({ priceMin, priceMax, unit, party, nights = 1, kind = "activity" }) {
  if (unit === "free") return { lo: 0, hi: 0, basis: "free", established: true }
  if (priceMin === null || priceMin === undefined) return { lo: 0, hi: 0, basis: "no-price", established: false, noPrice: true }
  const n = people(party), lo = priceMin, hi = priceMax === null || priceMax === undefined ? priceMin : priceMax
  const stay = kind === "stay"
  if (unit === "per_person") return { lo: lo * n * (stay ? nights : 1), hi: hi * n * (stay ? nights : 1), basis: "per_person", established: true }
  if (unit === "per_group") return { lo: lo * (stay ? nights : 1), hi: hi * (stay ? nights : 1), basis: "per_group", established: true }
  if (unit === "per_room" && stay) { const r = roomsFor(party); return { lo: lo * r * nights, hi: hi * r * nights, basis: "per_room", established: true, rooms: r } }
  if (unit === "per_night" && stay) return { lo: lo * nights, hi: hi * n * nights, basis: "per_night", established: n === 1, ambiguousBasis: n > 1 }
  // unknown unit (or a unit that makes no sense for this kind of stop): both readings stay open
  return { lo: lo * (stay ? nights : 1), hi: hi * n * (stay ? nights : 1), basis: "unknown", established: n === 1, ambiguousBasis: n > 1 }
}
// The verdict against a budget. Only "within" means affordability is established.
function verdict({ lo, hi, budget, unpriced }) {
  if (budget === null || budget === undefined) return null
  if (lo > budget) return "over"
  if (hi <= budget) return unpriced > 0 ? "within_listed" : "within"
  return "unclear"
}
module.exports = { stopCost, verdict, people, roomsFor }
