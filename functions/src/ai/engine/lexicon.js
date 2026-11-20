"use strict"
// Words the engine understands. DATA ONLY: add a synonym or an interest here without touching any logic.
// Everything is matched on normalised text (lower-case, accents and punctuation removed, see sanitize.normalizeName).
// English only. isiZulu (and other languages) would be added as another lexicon + locale; none is claimed yet.

// Listing categories -> the Firestore collections they live in (these collection names are the app's existing ones).
const CATEGORIES = {
  restaurants: { collection: "restaurants", words: ["restaurant", "restaurants", "eat", "eating", "food", "lunch", "dinner", "breakfast", "meal", "meals", "braai", "shisanyama", "shisa nyama", "kota", "cafe", "cafes", "coffee", "hungry", "takeaway", "eatery", "kasi food", "street food", "cuisine"] },
  accommodations: { collection: "accommodations", words: ["accommodation", "accommodations", "where to stay", "sleep", "hotel", "hotels", "lodge", "guesthouse", "guest house", "bnb", "b b", "hostel", "overnight", "homestay", "place to stay"] },
  attractions: { collection: "attractions", words: ["attraction", "attractions", "sight", "sights", "sightseeing", "museum", "museums", "memorial", "monument", "landmark", "landmarks", "heritage site", "historic site"] },
  recreation: { collection: "recreation", words: ["recreation", "activity", "activities", "adventure", "bungee", "park", "hike", "hiking", "cycling", "golf", "swimming"] },
  business: { collection: "business", words: ["business", "businesses", "shop", "shops", "store", "stores", "market", "markets", "salon", "craft", "crafts", "souvenir", "souvenirs", "local business", "local businesses", "vendor", "vendors"] },
  healthcare: { collection: "healthcare", words: ["clinic", "clinics", "hospital", "hospitals", "doctor", "doctors", "pharmacy", "healthcare", "medical"] },
  publicservice: { collection: "publicservice", words: ["home affairs", "municipal", "public service", "public services", "library", "post office", "government office"] },
}

// Interests -> words that signal them, and the categories where such records usually live (used only to choose where to look).
const INTERESTS = {
  history: { words: ["history", "historical", "historic", "heritage", "apartheid", "struggle", "museum", "memorial", "liberation", "1976", "mandela", "tutu"], categories: ["attractions", "business"] },
  food: { words: ["food", "eat", "eating", "cuisine", "braai", "shisanyama", "shisa nyama", "kota", "local food", "street food", "dining", "dishes"], categories: ["restaurants"] },
  culture: { words: ["culture", "cultural", "traditional", "tradition", "heritage", "township life", "local life", "authentic"], categories: ["attractions", "business", "restaurants"] },
  music: { words: ["music", "jazz", "kwaito", "amapiano", "live music", "concert", "dance", "dancing", "gospel", "house music"], categories: ["recreation", "restaurants", "attractions"] },
  nightlife: { words: ["nightlife", "club", "clubs", "tavern", "shebeen", "party", "bar", "bars", "drinks"], categories: ["restaurants", "recreation"] },
  family: { words: ["family", "kids", "children", "child", "child friendly", "family friendly", "toddler"], categories: ["recreation", "attractions", "restaurants"] },
  nature: { words: ["nature", "outdoor", "outdoors", "hike", "hiking", "walk", "walking", "dam", "green", "bird"], categories: ["recreation", "attractions"] },
  sport: { words: ["sport", "sports", "soccer", "football", "stadium", "rugby", "cricket", "running"], categories: ["recreation", "attractions"] },
  art: { words: ["art", "arts", "gallery", "galleries", "mural", "murals", "street art", "craft", "crafts", "artist", "artists"], categories: ["attractions", "business"] },
  shopping: { words: ["shopping", "shop", "market", "souvenir", "souvenirs"], categories: ["business"] },
}

// Experience style words (kept as plain tags; they influence ranking only when a record's own text says so).
const EXPERIENCE = {
  budget: ["cheap", "cheaper", "cheapest", "budget", "affordable", "inexpensive", "low cost", "on a budget", "free"],
  luxury: ["luxury", "luxurious", "upmarket", "fancy", "premium", "high end"],
  relaxed: ["relaxed", "relaxing", "quiet", "peaceful", "slow", "chill"],
  adventurous: ["adventure", "adventurous", "thrill", "exciting", "active"],
  romantic: ["romantic", "date night", "couple", "honeymoon"],
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const DAYPARTS = { morning: [6, 12], afternoon: [12, 17], evening: [17, 22], night: [20, 24] }

// Currency words that are NOT South African rand. The engine does not convert; it says so.
const FOREIGN_CURRENCY = /(\$|€|£|\busd\b|\beur\b|\bgbp\b|\bdollars?\b|\beuros?\b|\bpounds?\b)/i

module.exports = { CATEGORIES, INTERESTS, EXPERIENCE, WEEKDAYS, MONTHS, DAYPARTS, FOREIGN_CURRENCY }
