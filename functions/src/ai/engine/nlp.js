"use strict"
// Query clean-up that runs BEFORE intent detection and entity extraction. Deterministic, no model, no network.
//   * street abbreviations ("Vilakazi St" -> "Vilakazi Street")
//   * common typing shortcuts ("im", "whats")
//   * spelling: known misspellings, plus a conservative edit-distance-1 repair against the engine's own long vocabulary
//     (restaurant, accommodation, attraction, ...). Short words are never "corrected", so ordinary English is left alone.
// Only word tokens change; digits, currency ("R800"), punctuation and spacing are kept exactly.
const { landmarkWords } = require("./landmarks")

const ABBREV = { st: "street", str: "street", rd: "road", ave: "avenue", av: "avenue" }
const SHORTCUTS = { im: "i'm", ive: "i've", whats: "what's", wheres: "where's", dont: "don't", cant: "can't", wanna: "want to", gonna: "going to", pls: "please", plz: "please", u: "you" }
const MISSPELLED = {
  resturant: "restaurant", restaraunt: "restaurant", restuarant: "restaurant", restrant: "restaurant", restraunt: "restaurant", resteraunt: "restaurant", resturants: "restaurants", restaraunts: "restaurants", restuarants: "restaurants",
  acomodation: "accommodation", accomodation: "accommodation", acommodation: "accommodation", accommodaton: "accommodation", accomadation: "accommodation", accomodations: "accommodations", acommodations: "accommodations",
  hotle: "hotel", hotell: "hotel", hostle: "hostel", musem: "museum", musuem: "museum", museam: "museum", atraction: "attraction", atractions: "attractions", attracion: "attraction",
  sowetto: "soweto", suweto: "soweto", travelin: "traveling", travling: "traveling", itinary: "itinerary", itenerary: "itinerary", recomend: "recommend", reccomend: "recommend", recomendation: "recommendation",
  guesthause: "guesthouse", gesthouse: "guesthouse", brekfast: "breakfast", lunche: "lunch", dinnner: "dinner", activites: "activities", activties: "activities", vilakasi: "vilakazi", vilakazy: "vilakazi", vilakhazi: "vilakazi", vilikazi: "vilakazi", vilakaze: "vilakazi",
}
const VOCAB = ["restaurant", "restaurants", "accommodation", "accommodations", "attraction", "attractions", "itinerary", "recommend", "recommendation", "directions", "breakfast", "sightseeing", "guesthouse", "activities", "museums", "memorial", "monument", "landmarks", "township", "shisanyama", "takeaway", "transport", "tomorrow", "weekend", "budget", "history", "heritage", "festival", "concert", "adventure", "supermarket", "pharmacy", "clinic", "hospital", "library", "traveling", "travelling", "visiting"]

function damerau(a, b, max) { // optimal-string-alignment distance with an early exit
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[a.length][b.length]
}
function repair(word, vocab) {
  if (word.length < 6 || vocab.has(word)) return word
  let best = null
  for (const v of vocab) { if (v.length < 6) continue; const lim = v.length >= 12 ? 2 : 1; const d = damerau(word, v, lim); if (d <= lim && (best === null || d < best.d)) best = { v, d } }
  return best ? best.v : word
}
function clean(text, extra = []) {
  const vocab = new Set([...VOCAB, ...landmarkWords(), ...extra.map((x) => String(x).toLowerCase()).filter((x) => /^[a-z]{6,}$/.test(x))])
  return String(text || "").replace(/(?<![A-Za-z0-9])[A-Za-z]+(?:['’][A-Za-z]+)?(?![A-Za-z0-9])/g, (tok) => {
    const w = tok.toLowerCase().replace(/’/g, "'")
    if (ABBREV[w]) return ABBREV[w]
    if (SHORTCUTS[w]) return SHORTCUTS[w]
    if (MISSPELLED[w]) return MISSPELLED[w]
    return /'/.test(w) ? tok : repair(w, vocab) === w ? tok : repair(w, vocab)
  })
}
module.exports = { clean, damerau }
