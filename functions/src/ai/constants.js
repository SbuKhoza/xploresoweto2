"use strict"
const AI_COL = Object.freeze({ conversations: "ai-conversations", usage: "ai-usage", config: "ai-config" })
const MESSAGES = "messages"
// The ONLY collections the AI may read as "listings". Anything else (users, organisations, bookings, ...) is unreachable by design.
const LISTING_COLLECTIONS = Object.freeze(["accommodations", "restaurants", "attractions", "recreation", "business", "healthcare", "publicservice"])
// Every collection the assistant may read at all: the listings above plus public content the app already shows to everyone.
const PUBLIC_READ_COLLECTIONS = Object.freeze([...LISTING_COLLECTIONS, "events", "news", "announcements", "emergency", "transport", "loadshedding", "homescreen"])
const BOOKABLE_COLLECTIONS = Object.freeze(["accommodations", "restaurants"])
const BLOCK_TYPES = Object.freeze(["verified", "knowledge", "general", "suggestion", "unverified"])
module.exports = { AI_COL, MESSAGES, LISTING_COLLECTIONS, PUBLIC_READ_COLLECTIONS, BOOKABLE_COLLECTIONS, BLOCK_TYPES }
