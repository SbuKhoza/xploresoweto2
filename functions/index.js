"use strict"
// XploreSoweto trusted backend (Cloud Functions 2nd gen). NOT DEPLOYED until explicitly approved.
// Every function runs in africa-south1, requires authentication, validates its input and authorises on the server.
const { onCall } = require("firebase-functions/v2/https")
const { REGION } = require("./src/lib/constants")

const opts = { region: REGION, maxInstances: 10, cors: true }
// NOTE (App Check): not enforced in Stage 1 (the JS SDK on React Native needs a native-attestation provider). Per-user limits
// are enforced inside each function; see docs/stage1/ARCHITECTURE_AND_DATA_MODEL.md.
const wrap = (handler) => onCall(opts, (request) => handler(request))
// Stage 2A (AI). Same region/instance caps. ONLY aiChat is bound to the Anthropic secret and may call the provider; it also gets a
// longer timeout for the bounded tool loop. All other AI functions never see the key.
const { ANTHROPIC_API_KEY } = require("./src/ai/secrets")
const wrapChat = (handler) => onCall({ ...opts, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 90, memory: "512MiB", maxInstances: 10 }, (request) => handler(request))

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
  aiChat: wrapChat(ai.aiChat),
  aiGetUsage: wrap(ai.aiGetUsage),
  aiListConversations: wrap(ai.aiListConversations),
  aiGetConversation: wrap(ai.aiGetConversation),
  aiDeleteConversation: wrap(ai.aiDeleteConversation),
  aiDeleteAllMyAiData: wrap(ai.aiDeleteAllMyAiData),
  aiAdminGetUsage: wrap(ai.aiAdminGetUsage),
  aiAdminSetBreaker: wrap(ai.aiAdminSetBreaker),
  aiAdminUpdateConfig: wrap(ai.aiAdminUpdateConfig),
}
