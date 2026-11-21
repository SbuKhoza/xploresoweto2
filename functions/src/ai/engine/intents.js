"use strict"
// Intent detection: deterministic, weighted phrase patterns. No model involved.
// Extensible: to add an intent, call registerIntent({ id, patterns: [{ re, w }], priority }) (or add it to BUILTIN below);
// the detector, the engine's routing table and the tests all work from this registry.
// Detection returns EVERY intent that scored, best first, so a message like "cheap restaurants, how much is entry?" keeps both.
const { normalizeName } = require("../sanitize")

const REGISTRY = new Map()
// patterns run on the lower-cased raw text (keeps "R800" and punctuation); `w` is the weight of one hit.
function registerIntent(def) {
  if (!def || typeof def.id !== "string" || !Array.isArray(def.patterns)) throw new Error("intent needs an id and patterns")
  REGISTRY.set(def.id, { priority: 0, attribute: null, ...def })
}

const BUILTIN = [
  // ---- planning (highest priority: they own multi-step answers)
  { id: "build_itinerary", priority: 90, patterns: [[/\bitinerar(y|ies)\b/, 6], [/\bday ?plan\b/, 5], [/\bplan (my|our|a|the) (day|days|schedule)\b/, 6], [/\b(half|full)[- ]?day\b/, 3], [/\b\d{1,2}[- ]?days?\b/, 2], [/\bschedule (for|my|our)\b/, 4], [/\bwhat should (i|we) do (first|then|after)\b/, 3]] },
  { id: "plan_trip", priority: 80, patterns: [[/\bplan(ning)? (a |my |our |the )?(trip|visit|holiday|weekend|outing|day out)\b/, 6], [/\b(i'?m|we'?re|i am|we are|i will be|we will be) (visiting|coming to|in|travell?ing to)\b/, 4], [/\bwhat (can|could|should) (i|we) do\b/, 4], [/\bi (have|got) r ?\d/, 2], [/\bvisiting soweto\b/, 3], [/\b(my|our) (trip|visit)\b/, 2]] },
  { id: "compare", priority: 70, patterns: [[/\bcompare\b/, 6], [/\b(vs|versus)\b/, 5], [/\bwhich (one )?is (better|cheaper|best|closer)\b/, 5], [/\bdifference between\b/, 5], [/\bor\b.*\bwhich\b/, 2]] },
  { id: "recommend", priority: 60, patterns: [[/\brecommend(ation|ations)?\b/, 5], [/\bsuggest(ion|ions)?\b/, 4], [/\bbest\b/, 3], [/\btop\b/, 2], [/\bpopular\b/, 3], [/\bmust[- ](see|visit|try|do)\b/, 5], [/\bwhat'?s good\b/, 3], [/\bgood (place|spot)s?\b/, 2]] },
  { id: "discover_things", priority: 55, patterns: [[/\bthings to (do|see)\b/, 6], [/\bwhat to (do|see)\b/, 5], [/\bexplore\b/, 3], [/\bsomething (fun|interesting|different)\b/, 4], [/\bactivities\b/, 3], [/\bto do in soweto\b/, 4]] },
  // ---- finding things (category intents)
  { id: "find_restaurants", priority: 40, category: "restaurants", patterns: [[/\b(restaurants?|eateries|eatery|cafes?|takeaways?)\b/, 5], [/\bwhere (can|do|should) (i|we) eat\b/, 6], [/\b(food|lunch|dinner|breakfast|braai|shisa ?nyama|kota|coffee|hungry)\b/, 3]] },
  { id: "find_accommodation", priority: 40, category: "accommodations", patterns: [[/\baccommodation\b/, 6], [/\b(hotels?|lodges?|guest ?houses?|hostels?|b&b|bnb|homestay)\b/, 5], [/\b(where|place) to stay\b/, 6], [/\b(sleep|overnight)\b/, 3]] },
  { id: "find_attractions", priority: 40, category: "attractions", patterns: [[/\battractions?\b/, 6], [/\b(museums?|memorials?|monuments?|landmarks?|sights?|sightseeing)\b/, 4], [/\b(historic|historical|heritage) (sites?|places?)\b/, 5]] },
  { id: "find_tour_guides", priority: 45, patterns: [[/\btour ?guides?\b/, 8], [/\bguides?\b/, 3], [/\bguided\b/, 2]] },
  { id: "find_tours", priority: 44, patterns: [[/\btours?\b/, 6], [/\bguided (tour|walk|experience)\b/, 6], [/\bexperiences?\b/, 2]] },
  { id: "find_businesses", priority: 38, category: "business", patterns: [[/\b(local )?(business|businesses)\b/, 5], [/\b(shops?|stores?|markets?|salons?|crafts?|souvenirs?|vendors?)\b/, 3]] },
  { id: "find_events", priority: 42, patterns: [[/\bevents?\b/, 5], [/\bwhat'?s on\b/, 5], [/\b(festival|concert|gig|show)s?\b/, 3]] },
  // ---- other public content (each has its own stored collection)
  { id: "find_healthcare", priority: 40, category: "healthcare", patterns: [[/\b(clinics?|hospitals?|pharmac(y|ies)|doctors?|dentists?|medical|healthcare)\b/, 5]] },
  { id: "find_publicservice", priority: 40, category: "publicservice", patterns: [[/\b(home affairs|post office|librar(y|ies)|municipal(ity)?|government offices?|public services?)\b/, 5]] },
  { id: "find_transport", priority: 41, patterns: [[/\b(taxis?|minibus|buses|bus|trains?|metrorail|gautrain|rea vaya|uber|bolt|taxi ranks?)\b/, 5], [/\b(public )?transport\b/, 5], [/\b(get|getting) around\b/, 6]] },
  { id: "find_news", priority: 41, patterns: [[/\b(news|headlines?|top stories|latest stories)\b/, 6]] },
  { id: "find_announcements", priority: 41, patterns: [[/\b(announcements?|notices?|alerts?|advisor(y|ies)|road closures?|water (outage|shutdown)s?)\b/, 6]] },
  { id: "loadshedding", priority: 43, patterns: [[/\b(load ?shedding|power cuts?|blackouts?|eskom)\b/, 7]] },
  { id: "find_townships", priority: 39, patterns: [[/\b(list|which|what|show|name)\b.*\b(townships?|suburbs?|areas|neighbou?rhoods?)\b/, 6], [/\b(townships?|suburbs?) (of|in) soweto\b/, 6]] },
  // ---- questions about a particular place
  { id: "ask_place", priority: 30, patterns: [[/\btell me (more )?about\b/, 6], [/\bwhat is\b/, 2], [/\bwhat'?s\b.*\blike\b/, 3], [/\binfo(rmation)? (on|about)\b/, 5], [/\bhistory of\b/, 5], [/\bwho (is|was)\b/, 4], [/\bmore (info|details)\b/, 4], [/\bdetails\b/, 2]] },
  { id: "ask_price", priority: 32, attribute: "price", patterns: [[/\bhow much\b/, 6], [/\bprices?\b/, 5], [/\bcosts?\b/, 4], [/\b(entry|entrance|admission) fees?\b/, 6], [/\bfees?\b/, 3], [/\bcharge[sd]?\b/, 3], [/\bafford(able)?\b/, 3], [/\b(cheap|cheaper|cheapest)\b/, 2]] },
  { id: "ask_hours", priority: 32, attribute: "hours", patterns: [[/\b(opening|closing|operating) (hours|times?)\b/, 7], [/\bwhat time\b.*\b(open|close)/, 7], [/\b(open|closed?) (now|today|tomorrow|on|until|at)\b/, 5], [/\bhours\b/, 4], [/\bwhen (does|do|is)\b.*\b(open|close)/, 6], [/\bis .* open\b/, 5]] },
  { id: "ask_services", priority: 31, attribute: "services", patterns: [[/\bwhat (services|amenities|facilities)\b/, 6], [/\bwhat do(es)? (they|it) (offer|have|do|serve|sell)\b/, 6], [/\b(do|does) (they|it) (have|offer|serve|sell|provide)\b/, 5], [/\b(amenities|facilities|services)\b/, 3]] },
  { id: "ask_directions", priority: 33, attribute: "directions", patterns: [[/\bdirections?\b/, 7], [/\bhow (do|can|should) (i|we) get\b/, 7], [/\bhow (to )?get (to|there)\b/, 7], [/\bhow far\b/, 6], [/\bwhere is\b/, 4], [/\bdistance\b/, 4], [/\bnear(est|by)?\b/, 2], [/\b(address|location) of\b/, 4], [/\bget to\b/, 3]] },
  { id: "booking_request", priority: 36, patterns: [[/\b(book|booking|bookings|reserve|reservation|reservations)\b/, 6], [/\bmake a (booking|reservation)\b/, 3]] },
  // ---- safety and meta
  { id: "emergency", priority: 100, patterns: [[/\b(emergency|ambulance|police|fire brigade|robbery|robbed|mugged|attacked|urgent help|i need help now|help me now)\b/, 9]] },
  { id: "greeting", priority: 5, patterns: [[/^\s*(hi|hello|hey|howzit|sawubona|sanibonani|good (morning|afternoon|evening))\b/, 6]] },
  { id: "thanks", priority: 5, patterns: [[/^\s*(thanks|thank you|ngiyabonga|cheers|great thanks)\b/, 6]] },
  { id: "help", priority: 6, patterns: [[/\b(help|what can you (do|help)|how do(es)? this work|what are you)\b/, 5]] },
]
for (const b of BUILTIN) registerIntent({ ...b, patterns: b.patterns.map(([re, w]) => ({ re, w })) })

function detectIntents(text) {
  const t = String(text || "").toLowerCase()
  const scored = []
  for (const def of REGISTRY.values()) {
    let score = 0
    const hits = []
    for (const { re, w } of def.patterns) { const m = t.match(re); if (m) { score += w; hits.push(normalizeName(m[0]).slice(0, 30)) } }
    if (score > 0) scored.push({ id: def.id, score, priority: def.priority, attribute: def.attribute, category: def.category || null, hits })
  }
  // best first: emergencies and planning outrank everything; otherwise by score, then priority
  scored.sort((a, b) => (b.id === "emergency") - (a.id === "emergency") || b.score + b.priority / 100 - (a.score + a.priority / 100) || b.priority - a.priority)
  return scored
}
const knownIntents = () => [...REGISTRY.keys()]
module.exports = { registerIntent, detectIntents, knownIntents }
