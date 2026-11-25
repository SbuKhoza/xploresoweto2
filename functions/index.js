"use strict"
// XploreSoweto trusted backend (Cloud Functions 2nd gen). NOT DEPLOYED until explicitly approved.
// Every function runs in africa-south1, requires authentication, validates its input and authorises on the server.
const { onCall } = require("firebase-functions/v2/https")
const { defineSecret } = require("firebase-functions/params")
const { REGION } = require("./src/lib/constants")
const environment = require("./src/lib/environment")

// Staging (exact project id xploresoweto-staging) is capped at 3 instances per function; every other target keeps 10, as before.
const opts = { region: REGION, maxInstances: environment.maxInstances(), cors: true }
// NOTE (App Check): not enforced in Stage 1 (the JS SDK on React Native needs a native-attestation provider). Per-user limits
// are enforced inside each function; see docs/stage1/ARCHITECTURE_AND_DATA_MODEL.md.
const wrap = (handler) => onCall(opts, (request) => handler(request))
// Stage 2B (database-powered assistant). Malloya itself needs no secret. The OPTIONAL Luna wording layer uses ONE secret, bound to aiChat
// ONLY (no other function can read it). The secret must exist in Secret Manager before aiChat is deployed:
//   firebase functions:secrets:set OPENAI_API_KEY --project xploresoweto   (entered by the owner; never committed, logged or sent to the app)
const OPENAI_API_KEY = environment.bindProviderSecret() ? defineSecret("OPENAI_API_KEY") : null // staging: not even declared
// STAGING: the secret is NOT bound (there is no key there and none is ever copied from production), so aiChat deploys without it and serves
// Malloya deterministically. Only the exact staging project id removes the binding; any other or unknown target keeps it and a deploy
// without the secret then fails loudly instead of silently running without it. Luna is also blocked at runtime in staging (see
// src/ai/luna/index.js and provider.js), so an injected key could not cause a provider call either.
const withOpenAiKey = (handler) => onCall({ ...opts, ...(environment.bindProviderSecret() ? { secrets: [OPENAI_API_KEY] } : {}) }, (request) => handler(request))

const profile = require("./src/handlers/profile")
const platform = require("./src/handlers/platform")
const loadshedding = require("./src/handlers/loadshedding")
const applications = require("./src/handlers/applications")
const organisations = require("./src/handlers/organisations")
const invitations = require("./src/handlers/invitations")
const members = require("./src/handlers/members")
const requests = require("./src/handlers/requests")
const reviews = require("./src/handlers/reviews")
const listings = require("./src/handlers/listings")
const ai = require("./src/handlers/ai")

module.exports = {
  // required Stage 1 functions
  ensureUserProfile: wrap(profile.ensureUserProfile),
  managePlatformRole: wrap(platform.managePlatformRole),
  seedLoadshedding: wrap(loadshedding.seedLoadshedding),
  submitProviderApplication: wrap(applications.submitProviderApplication),
  reviewProviderApplication: wrap(applications.reviewProviderApplication),
  setOrganisationStatus: wrap(organisations.setOrganisationStatus),
  inviteOrganisationMember: wrap(invitations.inviteOrganisationMember),
  listOrganisationInvitations: wrap(invitations.listOrganisationInvitations),
  revokeOrganisationInvitation: wrap(invitations.revokeOrganisationInvitation),
  listMyInvitations: wrap(invitations.listMyInvitations),
  acceptOrganisationInvitation: wrap(invitations.acceptOrganisationInvitation),
  declineOrganisationInvitation: wrap(invitations.declineOrganisationInvitation),
  setMemberRole: wrap(members.setMemberRole),
  removeOrganisationMember: wrap(members.removeOrganisationMember),
  // additional functions required to keep existing features working without client-side trust (booking, service request, review)
  createBookingRequest: wrap(requests.createBookingRequest),
  createServiceRequest: wrap(requests.createServiceRequest),
  updateRequestStatus: wrap(requests.updateRequestStatus),
  checkReviewEligibility: wrap(reviews.checkReviewEligibility),
  submitReview: wrap(reviews.submitReview),
  // lifecycle step 9: organisation members submit listings, staff review and publish
  submitListing: wrap(listings.submitListing),
  reviewListingSubmission: wrap(listings.reviewListingSubmission),
  // Stage 2A: AI backend (not deployed until approved)
  aiChat: withOpenAiKey(ai.aiChat),
  aiSetLunaConsent: wrap(ai.aiSetLunaConsent),
  aiGetUsage: wrap(ai.aiGetUsage),
  aiListConversations: wrap(ai.aiListConversations),
  aiGetConversation: wrap(ai.aiGetConversation),
  aiDeleteConversation: wrap(ai.aiDeleteConversation),
  aiDeleteAllMyAiData: wrap(ai.aiDeleteAllMyAiData),
  aiAdminGetUsage: wrap(ai.aiAdminGetUsage),
  aiAdminUpdateConfig: wrap(ai.aiAdminUpdateConfig),
}
