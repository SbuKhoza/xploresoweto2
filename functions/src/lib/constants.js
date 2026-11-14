"use strict"
// Single source of truth for names, roles and limits. REGION must match the Firestore location (africa-south1)
// and the mobile app's getFunctions(app, "africa-south1").
const REGION = "africa-south1"

const COL = Object.freeze({
  users: "users",
  superAdmin: "super-admin",
  editors: "platform-editors",
  audit: "audit-log",
  applications: "provider-applications",
  orgs: "organisations",
  members: "organisation-members",
  invitations: "organisation-invitations",
  submissions: "listing-submissions",
  bookings: "bookings",
  serviceRequests: "service-requests",
  reviews: "reviews",
  loadshedding: "loadshedding",
})

const ORG_TYPES = Object.freeze(["business", "restaurant", "accommodation", "tour_operator", "tour_guide", "other_service_provider"])
const ORG_ROLES = Object.freeze(["owner", "manager", "reservations_manager", "content_manager", "employee"])
const PERMISSIONS = Object.freeze(["profile.edit", "content.manage", "bookings.read", "bookings.manage", "enquiries.manage", "members.manage"])

// Permissions are resolved on the server and stored on the membership. Clients never choose them.
const ROLE_PERMISSIONS = Object.freeze({
  owner: [...PERMISSIONS],
  manager: ["profile.edit", "content.manage", "bookings.read", "bookings.manage", "enquiries.manage", "members.manage"],
  reservations_manager: ["bookings.read", "bookings.manage", "enquiries.manage"],
  content_manager: ["profile.edit", "content.manage"],
  employee: ["bookings.read"],
})
// Roles a non-owner member-manager may assign/modify/remove. Only owners create or alter owners and managers.
const MANAGER_ASSIGNABLE_ROLES = Object.freeze(["employee", "reservations_manager", "content_manager"])

// Provider type -> public collection its listings are published to (tour packages are NOT part of Stage 1)
const LISTING_TARGETS = Object.freeze({
  restaurant: "restaurants",
  accommodation: "accommodations",
  business: "business",
  other_service_provider: "business",
})
const BOOKABLE_COLLECTIONS = Object.freeze(["accommodations", "restaurants"])
const SERVICE_COLLECTIONS = Object.freeze(["business"])

const LIMITS = Object.freeze({
  MAX_OPEN_APPLICATIONS: 3,
  INVITE_TTL_DAYS: 7,
  MAX_PENDING_INVITES_PER_ORG: 50,
  MAX_PENDING_REQUESTS_PER_USER: 10,
  MAX_PENDING_SUBMISSIONS_PER_ORG: 20,
  MAX_DOCUMENT_PATHS: 10,
  MAX_IMAGE_PATHS: 8,
  LOADSHEDDING_MAX_DOCS: 500,
})

module.exports = { REGION, COL, ORG_TYPES, ORG_ROLES, PERMISSIONS, ROLE_PERMISSIONS, MANAGER_ASSIGNABLE_ROLES, LISTING_TARGETS, BOOKABLE_COLLECTIONS, SERVICE_COLLECTIONS, LIMITS }
