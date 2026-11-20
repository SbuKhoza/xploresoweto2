"use strict"
// ALL user-facing English wording. Adding a language = adding a sibling file with the same keys (and tests); nothing else changes.
// Wording rules (enforced by tests): never say a place is available/full/booked, never say a booking is made or confirmed,
// never give a travel time, never present a guess as fact.
const rand = (n) => `R${Number.isInteger(n) ? n : n.toFixed(2)}`
const plural = (n, one, many) => (n === 1 ? one : many)
module.exports = {
  code: "en",
  categoryLabel: { restaurants: "restaurants", accommodations: "places to stay", attractions: "attractions", recreation: "activities", business: "local businesses", healthcare: "healthcare services", publicservice: "public services" },
  rand, plural,
  greeting: "Hi! I can help you find attractions, restaurants, places to stay and local businesses in Soweto, and suggest a plan for your visit using what is listed on XploreSoweto. What would you like to do?",
  help: "I can: find restaurants, places to stay, attractions, activities and local businesses; suggest a half-day, full-day or multi-day plan from your interests and budget; compare places; tell you the listed price, hours and services of a place; and share what the XploreSoweto township guide says. Everything I show comes from XploreSoweto records. Try: \"Plan a day in Soweto with R800, I like history and food\".",
  thanks: "You're welcome! Ask me anything else about Soweto.",
  unknown: "I'm not sure what you'd like to do. I can find restaurants, places to stay, attractions, activities and local businesses, or plan a visit. Try asking, for example, \"Where can I eat kota in Orlando West?\" or \"Plan a day with R800, I like history and food\".",
  notSupportedLanguage: "I can only answer in English for now, so I'll reply in English. isiZulu support is planned but not ready yet.",
  currencyNote: "I only work in South African rand (R), and I can't convert other currencies, so I haven't used that amount.",
  datePast: (label) => `${label} has already passed, so I haven't used it.`,
  carried: (parts) => `Still using what you told me earlier: ${parts.join("; ")}.`,
  // ---- find
  foundIntro: (n, label, where) => `I found ${n} ${plural(n, "match", "matches")} for ${label}${where ? ` in ${where}` : ""} on XploreSoweto.`,
  foundNone: (label, where) => `I couldn't find any ${label}${where ? ` in ${where}` : ""} on XploreSoweto that match your request.`,
  relaxedTerms: (terms, label) => `Nothing matched "${terms}", so these are the highest-ranked ${label} instead.`,
  relaxedPlace: (place, label) => `Nothing matched ${place} exactly, so these are the highest-ranked ${label} across Soweto.`,
  truncated: (n) => `I searched the first ${n} records of this category, so there may be more that I did not look at.`,
  excluded: { overBudget: (n) => `${n} ${plural(n, "listing was", "listings were")} left out because the listed price is above your budget.`, notAccessible: (n) => `${n} ${plural(n, "listing was", "listings were")} left out because ${plural(n, "it is", "they are")} marked as not accessible.`, accessibilityUnknown: (n) => `${n} ${plural(n, "listing was", "listings were")} left out because accessibility is not recorded.`, notOpenNow: (n) => `${n} ${plural(n, "listing was", "listings were")} left out because the stored hours show ${plural(n, "it is", "they are")} closed now.`, hoursUnknown: (n) => `${n} ${plural(n, "listing was", "listings were")} left out because the stored hours do not prove ${plural(n, "it is", "they are")} open now.`, belowRating: (n) => `${n} ${plural(n, "listing was", "listings were")} left out because the rating is below what you asked for.` },
  whyHeader: "Why these (my ranking, using only what is stored):",
  noLocation: "You asked for places near you, but you have not shared your location, so I could not use distance.",
  facts: { price: (p) => `listed price ${p}`, noPrice: "no price listed", hours: (h) => `hours: ${h}`, noHours: "hours not listed", rating: (r, n) => `rated ${r}${n ? ` (${n} ${plural(n, "review", "reviews")})` : ""}`, noRating: "no rating yet", km: (k) => `about ${k} km away in a straight line (approximate)`, phone: (p) => `phone ${p}`, openNow: "stored hours show it is open now", closedNow: "stored hours show it is closed now", accessible: "marked accessible" },
  // ---- ask about one place
  askNotFound: (name) => `I couldn't find "${name}" on XploreSoweto.`,
  askWhich: "Which place do you mean? Tell me its name, or ask about one of the places I just showed you.",
  askPrice: (name, price) => `${name}: listed price ${price}. This is the price stored on XploreSoweto; I can't confirm it is current.`,
  askNoPrice: (name) => `${name} has no price listed on XploreSoweto, so I can't tell you what it costs. Try its contact details on the listing.`,
  askHours: (name, hours) => `${name}: hours listed as "${hours}".`,
  askNoHours: (name) => `${name} has no opening hours listed on XploreSoweto, so I can't tell you when it is open.`,
  askOpenNote: { open: "Going by the stored hours it looks open right now, but please confirm before you go.", closed: "Going by the stored hours it looks closed right now.", unknown: "The stored hours are not in a form I can check against the time now, so I can't say whether it is open at the moment." },
  askServices: (name, list) => `${name} lists: ${list.join(", ")}.`,
  askNoServices: (name) => `${name} has no services or features listed on XploreSoweto.`,
  askDirections: (name, addr) => `${name}${addr ? ` is at ${addr}` : " has no address listed"}.`,
  directionsHow: "Open the listing in the app and use its Directions button for turn-by-turn directions. I can't give driving or walking times.",
  directionsKm: (k) => `From the position you shared it is about ${k} km in a straight line (approximate, not driving distance or travel time).`,
  aboutPlace: (name) => `Here is what XploreSoweto lists for ${name}:`,
  askDesc: (d) => `Description on the listing: ${d}`,
  // ---- booking (requests only)
  bookable: (name) => `${name} accepts booking requests through XploreSoweto. I can't book for you: open the listing and send a request. The provider accepts or declines it, and nothing is confirmed until they respond.`,
  notBookable: (name) => `${name} is information-only on XploreSoweto and doesn't take booking requests here, so please use its contact details on the listing.`,
  bookingNoPlace: "Which place would you like to request a booking for? I can't make bookings myself; I can point you to the request option on a listing that accepts them.",
  bookingNote: "Booking is a request only: the provider accepts or declines it, and nothing is confirmed until they respond.",
  // ---- compare
  compareIntro: (n) => `Here is a side-by-side of ${n} places, using only what is stored:`,
  compareNeedTwo: "Which places would you like me to compare? Name two places, or ask me to compare options in a category (for example, accommodation).",
  compareCheaper: (a, b) => `Of these two, ${a} has the lower listed price (${b}).`,
  compareRating: (a, b) => `${a} has the higher rating (${b}).`,
  compareNoBasis: "There isn't enough stored information (price or rating on both) to say which is better value.",
  // ---- plan
  planIntro: (kind, days, dateLabel) => `Here is a suggested ${kind === "half_day" ? "half-day" : days > 1 ? `${days}-day` : "one-day"} plan${dateLabel ? ` for ${dateLabel}` : ""}, built only from records on XploreSoweto. Names, prices, hours and ratings come from the records; the order and timing are only my suggestion.`,
  slot: { morning: "Morning", midday: "Midday", afternoon: "Afternoon", evening: "Evening" },
  dayHeader: (d, total) => (total > 1 ? `Day ${d}` : null),
  stopKm: (k) => `about ${k} km from the previous stop (approximate)`,
  planTotal: (n, budget) => `Listed prices for these stops add up to at least ${rand(n)} (the lowest figure is used where a range is listed)${budget != null ? `, against your budget of ${rand(budget)}` : ""}.`,
  planNoCost: "None of the chosen stops has a listed price, so I can't total the cost.",
  planStay: (name, price) => `If you need somewhere to stay: ${name}${price ? ` (${price})` : ""}. Accommodation is not included in the total above.`,
  planNothing: "I couldn't find suitable records to build a plan from, so I haven't invented one.",
  planMissing: (kinds) => `There were not enough matching ${kinds.map((k) => (k === "meal" ? "restaurants" : "attractions or activities")).join(" and ")} in the records to fill every slot, so some slots are left empty rather than invented.`,
  // ---- clarification
  clarifyPlan: "I can plan that for you. What would you like to do (for example history, food, music, family activities), and roughly what is your budget in rand?",
  clarifyPlanBudgetOnly: "Do you have particular interests, such as history, food, music or family activities? That helps me choose.",
  // ---- knowledge
  kbIntro: "From the XploreSoweto township guide:",
  kbNone: "The XploreSoweto township guide has no passage on that topic, so I can't tell you more without guessing.",
  // ---- events
  eventsIntro: (n) => `Upcoming events listed on XploreSoweto (${n}):`,
  eventsNone: "I couldn't find any approved upcoming events for that period.",
  eventLine: (e) => `${e.title}${e.date ? ` on ${e.date}${e.time ? ` at ${e.time}` : ""}` : ""}${e.location ? `, ${e.location}` : ""}`,
  // ---- emergency
  emergencyIntro: "If someone is in danger, contact the emergency service directly now. These are the numbers listed on XploreSoweto:",
  emergencyNone: "XploreSoweto has no emergency numbers stored right now. In South Africa you can dial 10111 for police, 10177 for an ambulance, or 112 from a mobile phone. (This is general safety information, not from XploreSoweto records.)",
  emergencyNote: "I can't call anyone for you or give medical advice.",
  // ---- tours / guides
  noTourData: (what) => `XploreSoweto doesn't have a dedicated ${what} section yet. I searched attractions, activities and local businesses for the word "${what === "tour guides" ? "guide" : "tour"}" and ${what === "tour guides" ? "none mention guides" : "none mention tours"}.`,
  tourIntro: (n, what) => `XploreSoweto has no dedicated ${what} listings, but ${n} ${plural(n, "record mentions", "records mention")} ${what === "tour guides" ? "guides" : "tours"} in ${plural(n, "its", "their")} stored text:`,
  // ---- follow-ups
  follow: { details: "Tell me more about the first one", cheaper: "Which of these has the lowest listed price?", plan: "Plan a day using these", cats: "Show me places to eat", stay: "Where can I stay?", party: "I'm travelling with 2 people", interests: "I like history and food", directions: "How far is the first one?", events: "What events are on?" },
}
