"use strict"
const AI_COL = Object.freeze({ conversations: "ai-conversations", usage: "ai-usage", config: "ai-config" })
const MESSAGES = "messages"
// The ONLY collections the AI may read as "listings". Anything else (users, organisations, bookings, ...) is unreachable by design.
const LISTING_COLLECTIONS = Object.freeze(["accommodations", "restaurants", "attractions", "recreation", "business", "healthcare", "publicservice"])
const BOOKABLE_COLLECTIONS = Object.freeze(["accommodations", "restaurants"])
const BLOCK_TYPES = Object.freeze(["verified", "knowledge", "general", "suggestion", "unverified"])
module.exports = { AI_COL, MESSAGES, LISTING_COLLECTIONS, BOOKABLE_COLLECTIONS, BLOCK_TYPES }
