# Stage 1 architecture and data model

Project `xploresoweto` · Firestore and Cloud Functions in `africa-south1` · Functions: 2nd gen, Node 22, Admin SDK.
Everything here is **prepared, not deployed**.

## Principles
1. **Clients read; sensitive writes are Cloud Functions.** A client may directly update only a few fields of its own `users/{uid}` profile. Every other create/update/delete (profiles, applications, organisations, memberships, invitations, bookings, service requests, reviews, audit logs, listing publication, loadshedding) is a callable function using the Admin SDK, which bypasses rules.
2. **Staff need three things.** A claim (`superAdmin` / `editor`) is only a hint. Access requires the claim AND a verified email AND an active authoritative record (`super-admin/{uid}` or `platform-editors/{uid}`), checked in functions and in rules.
3. **Organisation access = membership.** `organisation-members/{organisationId}_{userId}` documents (written only by functions) carry the role and server-resolved permissions. One user can have many memberships with different roles; nothing about organisations lives on the user document.
4. **Retry-safe by construction.** Deterministic document ids (`uid`, `uid_requestId`, `orgId_uid`, `sha256(orgId|email)`) plus "already done → return the existing result" make every operation idempotent; concurrent calls are covered by Firestore transactions. Audit entries are written in the same transaction and only when state actually changed.
5. **Rules are not filters.** Public content is readable only while `isActive == true`, so every public query asks for `where("isActive","==",true)` (central in `utils/publicContent.js`).

## Collections (all created automatically on first write; nothing to create by hand)
| Collection / id | Written by | Read by (client) |
|---|---|---|
| `users/{uid}` | `ensureUserProfile` (create); owner updates allow-listed fields | owner only (no listing, so no email exposure) |
| `super-admin/{uid}` | **you, manually, once**; later `managePlatformRole` | active super admin |
| `platform-editors/{uid}` | `managePlatformRole` | active super admin |
| `audit-log/{auto}` | functions | active super admin |
| `provider-applications/{uid_requestId}` | `submitProviderApplication`, `reviewProviderApplication` | applicant, active super admin |
| `organisations/{applicationId}` | created on approval; members edit `description, contact, logoUrl` | active members, active super admin |
| `organisation-members/{orgId_uid}` | functions | the member; members with `members.manage`; super admin |
| `organisation-invitations/{sha256(orgId\|email)}` | functions | **nobody** (functions return masked emails) |
| `listing-submissions/{orgId_requestId}` | `submitListing`, `reviewListingSubmission` | members with `content.manage`; staff |
| `bookings/{uid_requestId}`, `service-requests/{uid_requestId}` | `create*Request`, `updateRequestStatus` | customer; members with `bookings.read` / `enquiries.manage`; super admin |
| `reviews/{uid_collection_listingId}` | `submitReview` | any signed-in user |
| existing content: accommodations, attractions, business, restaurants, recreation, events, news, announcements, transport, healthcare, emergency, publicservice, homescreen, xplore-menu, loadshedding | staff (CMS), `reviewListingSubmission`, `seedLoadshedding` | anyone, **only while `isActive == true`** |

Not created and not granted: `admin`, `userservices` (replaced by `service-requests`), `Person-Of-Interest`, tours, itineraries, AI collections.

## Cloud Functions (21)
| Function | Caller must be |
|---|---|
| `ensureUserProfile` | signed in |
| `managePlatformRole` | active super admin |
| `seedLoadshedding` | active super admin |
| `submitProviderApplication` | verified email |
| `reviewProviderApplication` | active super admin (never the applicant) |
| `setOrganisationStatus` | active super admin |
| `inviteOrganisationMember`, `listOrganisationInvitations`, `revokeOrganisationInvitation` | verified; member with `members.manage` (role limits apply) |
| `listMyInvitations`, `acceptOrganisationInvitation`, `declineOrganisationInvitation` | verified; email must equal the invited email |
| `setMemberRole`, `removeOrganisationMember` | member with `members.manage` (or the member leaving) |
| `createBookingRequest`, `createServiceRequest` | verified |
| `updateRequestStatus` | provider (accept / decline / complete) or the customer (confirm / cancel) |
| `checkReviewEligibility`, `submitReview` | verified; needs a **completed, customer-confirmed** request |
| `submitListing` | verified; member with `content.manage` |
| `reviewListingSubmission` | active super admin or editor |

The last six are beyond the 14 you listed; they are needed so the existing booking, service-request and review features keep working without client-side trust, and for lifecycle step 9.

### Roles
owner: everything. manager: everything, but can only assign/modify/remove staff-level roles (employee, reservations manager, content manager) and never themselves. reservations manager: bookings read/manage, enquiries. content manager: edit organisation info, content/listings. employee: read bookings. Only owners create or change owners and managers; the last owner can never be removed or demoted. Permissions are resolved on the server from the role and re-checked on every call and in the rules.

### Invitations
256-bit random token returned once to the inviter; only its SHA-256 is stored; 7-day expiry; single use; revocable. The invitee needs a **verified** email equal to the invited one, and either the token or the in-app invitation id. Wrong person / wrong token / missing invitation all return the same error. The invitation id is a hash, so no email appears in any path or query.

### Review eligibility (provider cannot unlock reviews alone)
`pending → accepted → completed_by_provider → completed`. The provider performs the first three steps; **only the customer** can perform `confirmCompletion`. Only `completed` qualifies, one review per customer per listing. No client flag is consulted.

## Content contract for the CMS (needed before the new rules go live)
Every public document must contain `isActive: true` (documents without it are invisible, by design). The documented `homescreen/featured` document has no `isActive` field today and must get one. Staff-created listings may carry `organisationId` to become bookable.

## Not covered by Stage 1
Provider-facing screens, a customer "My requests"/confirm-completion screen, email notifications, payments, tours, AI. Without those screens the backend flows exist but nothing in the app triggers provider responses or customer confirmation yet (see STAGE1_REPORT).
