"use strict"
// Shared fixture for the engine tests: an in-memory Firestore seeded with a small, FICTIONAL Soweto-like dataset (including records that
// must never be shown: inactive, suspended organisation, unpublished, private collections). No production connection.
const { setupAi } = require("./ai_helpers")
const C = require("../src/ai/config")
const { clearToolCache } = require("../src/ai/retrieval/data")

const PRIVATE = ["PRIVATE-ORG-PHONE", "secret@private.test", "ownerUid", "owner-uid-123", "customerEmail", "Hidden Application Name", "super-secret-note", "UNPUBLISHED-CMS-TEXT"]
const cfg = C.merge(C.DEFAULTS, { cache: { listingTtlSeconds: 0 } })

function seedWorld(env) {
  env.seed("organisations/orgA", { name: "Org A", approvalStatus: "approved", active: true, ownerUid: "owner-uid-123", contact: { phone: "PRIVATE-ORG-PHONE" } })
  env.seed("organisations/orgS", { name: "Suspended Org", approvalStatus: "suspended", active: false, ownerUid: "owner-uid-123" })
  env.seed("users/someone", { email: "secret@private.test" }); env.seed("bookings/b1", { customerEmail: "secret@private.test", organisationId: "orgA" })
  env.seed("provider-applications/ap1", { organisationName: "Hidden Application Name" }); env.seed("super-admin/root", { note: "super-secret-note" })
  env.seed("reviews/rv1", { userId: "u9", comment: "super-secret-note review text", rating: 1 })
  const at = (lat, lng) => ({ latitude: lat, longitude: lng })
  // restaurants
  env.seed("restaurants/r1", { name: "Gogo's Kitchen", description: "Home cooking, kota and pap", location: "Vilakazi Street, Orlando West", cuisine: "Traditional", price: "R80 - R150", hours: "08:00 - 17:00", rating: 4.6, reviews: 40, tags: ["kota", "family"], isActive: true, organisationId: "orgA", coordinates: at(-26.2385, 27.9065) })
  env.seed("restaurants/r2", { name: "Mama's Braai Spot", description: "Shisa nyama and local food", location: "Diepkloof", cuisine: "Braai", hours: "Mon-Fri 9-5", rating: 3.9, reviews: 5, isActive: true, coordinates: at(-26.25, 27.92) })
  env.seed("restaurants/r3", { name: "Inactive Diner", description: "UNPUBLISHED-CMS-TEXT", location: "Orlando", isActive: false })
  env.seed("restaurants/r4", { name: "Suspended Org Eatery", description: "food", location: "Orlando", isActive: true, organisationId: "orgS" })
  env.seed("restaurants/r5", { name: "Draft Grill", description: "UNPUBLISHED-CMS-TEXT", location: "Orlando", isActive: true, listingStatus: "suspended" })
  env.seed("restaurants/r6", { name: "Pricey Steakhouse", description: "Fine dining, local food", location: "Maponya", price: "R900", rating: 4.8, reviews: 60, isActive: true })
  // attractions
  env.seed("attractions/a1", { name: "Hector Pieterson Museum", description: "Memorial and museum about the 1976 uprising. History of the struggle.", type: "Museum", price: 60, hours: "24 hours", isActive: true, location: "Orlando West", rating: 4.7, reviews: 120, coordinates: at(-26.2306, 27.9061) })
  env.seed("attractions/a2", { name: "Mandela House", description: "Former home of Nelson Mandela. Heritage and history.", type: "Museum", entryFee: "R100", hours: "09:00 - 17:00", isActive: true, location: "Vilakazi Street, Orlando West", rating: 4.5, reviews: 80, coordinates: at(-26.2379, 27.9063) })
  env.seed("attractions/a3", { name: "Regina Mundi Church", description: "Historic church of the liberation struggle.", type: "Church", isActive: true, location: "Rockville", rating: 4.4, reviews: 30 })
  env.seed("attractions/a4", { name: "Expensive Heritage Tour", description: "Guided tour of Soweto history with a local guide", type: "Tour", price: "R950", isActive: true, location: "Soweto", rating: 4.9, reviews: 10 })
  env.seed("recreation/rc1", { name: "Orlando Towers Bungee", description: "Bungee jumping and adventure", type: "Adventure", price: "R450", duration: "2 hours", isActive: true, location: "Orlando", rating: 4.3, reviews: 20 })
  env.seed("accommodations/ac1", { name: "Vilakazi Guest House", description: "Quiet guest house", type: "Guest house", price: "R700", priceNum: 700, isActive: true, location: "Orlando West", organisationId: "orgA", rating: 4.2, reviews: 12 })
  env.seed("business/b1", { name: "Soweto Craft Market", description: "Local crafts and art", type: "Market", isActive: true, location: "Maponya" })
  // public content
  env.seed("homescreen/t1", { type: "township", name: "Orlando West", description: "Home of Vilakazi Street, where two Nobel Peace laureates lived.", history: "Orlando West grew in the 1950s.", isActive: true })
  env.seed("emergency/e1", { name: "Police", number: "10111", category: "police", isActive: true, order: 1 })
  env.seed("events/ev1", { title: "Jazz in the Park", date: "2026-11-21", time: "18:00", location: "Orlando Amphitheatre", category: "Music", isActive: true, description: "Live jazz" })
}
function setupWorld() { const env = setupAi(); clearToolCache(); seedWorld(env); return env }
const ctxFor = (env, o = {}) => ({ cfg, now: new Date(env.time.now), location: null, ...o }) // T0 = Sat 14 Nov 2026 12:00 SAST
module.exports = { setupWorld, seedWorld, ctxFor, cfg, PRIVATE }
