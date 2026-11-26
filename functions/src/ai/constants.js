"use strict"
const AI_COL = Object.freeze({ conversations: "ai-conversations", usage: "ai-usage", config: "ai-config", consent: "ai-consent", candidates: "ai-learning-candidates", knowledge: "ai-knowledge", seen: "ai-learning-seen", optout: "ai-learning-optout", events: "ai-learning-events" })
const MESSAGES = "messages"
// The ONLY collections the AI may read as "listings". Anything else (users, organisations, bookings, ...) is unreachable by design.
const LISTING_COLLECTIONS = Object.freeze(["accommodations", "restaurants", "attractions", "recreation", "business", "healthcare", "publicservice"])
// Every collection the assistant may read at all: the listings above plus public content the app already shows to everyone.
const PUBLIC_READ_COLLECTIONS = Object.freeze([...LISTING_COLLECTIONS, "events", "news", "announcements", "emergency", "transport", "loadshedding", "homescreen"])
// Collections that hold personal, account or operational data. The assistant can NEVER read these: they are not on the allow-list above,
// and a test asserts the two lists never overlap. (Deny-by-default: a new collection is invisible to the assistant until it is added above.)
const PRIVATE_COLLECTIONS = Object.freeze(["users", "super-admin", "platform-editors", "audit-log", "provider-applications", "organisations", "organisation-members",
  "organisation-invitations", "listing-submissions", "bookings", "service-requests", "reviews", "Person-Of-Interest", "ai-conversations", "ai-usage", "ai-config", "ai-consent", "ai-learning-candidates", "ai-knowledge", "ai-learning-seen", "ai-learning-optout", "ai-learning-events", "xplore-menu"])
const BOOKABLE_COLLECTIONS = Object.freeze(["accommodations", "restaurants"])
const BLOCK_TYPES = Object.freeze(["verified", "knowledge", "general", "suggestion", "unverified"])
const LEARNING_NOTICE_VERSION = 1 // bump with utils/ai/learning.js when the wording of the learning notice changes
module.exports = { LEARNING_NOTICE_VERSION, PRIVATE_COLLECTIONS, AI_COL, MESSAGES, LISTING_COLLECTIONS, PUBLIC_READ_COLLECTIONS, BOOKABLE_COLLECTIONS, BLOCK_TYPES }
