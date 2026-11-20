# Stage 2B, Phase 1: repository and architecture audit

Written before any Stage 2B code. Everything here comes from the repository, not from live Firestore data (production was not and must not be read).

## 1. Starting state

| Item | Finding |
|---|---|
| New branch | `stage2b/database-ai`, created from `stage2a/ai-backend` |
| Starting commit | `bdac9dddc8dbd22707a570e2817a869bbcec5311` |
| Working tree before branching | clean (`git status` showed no changes) |
| Existing branches kept | `main`, `stage1/firebase-transition`, `stage2a/ai-backend`, `origin/upgrade/expo-sdk-58` |
| Not on `origin` | `stage1/firebase-transition` is on origin; `stage2a/ai-backend` was **never pushed** (it exists only in this workspace and in the delivered bundle). Nothing was pushed from this branch either. |

Stage 2B is branched from Stage 2A (not Stage 1) because it reuses Stage 2A work; the history of both is preserved and untouched.

## 2. Where Anthropic and model-specific code lives

Runtime: `functions/package.json` (`@anthropic-ai/sdk`), `functions/index.js` (secret import, `wrapChat`, 512 MiB / 90 s), `src/ai/secrets.js`, `src/ai/providers/{index,anthropic}.js`, `src/ai/prompt.js`, `src/ai/cost.js`, token and price handling in `src/ai/config.js` and `src/ai/usage.js`, provider orchestration in `src/ai/chat.js`, model-output handling in `src/ai/grounding.js`, and `src/ai/tools/{registry,schema}.js` (the model-facing tool surface).
Tests: `ai_chat`, `ai_foundation`, `ai_tools`, `ai_usage`, `ai_security`, `ai_helpers` contain scripted-provider and cost assertions.
Docs: `docs/stage2/{STAGE2A_SETUP_AND_DEPLOYMENT,STAGE2A_REVIEW_REPORT,VERIFICATION_RECORD}.md`.
Ignore rules: `.gitignore` entries for `functions/.secret.local` (harmless, kept as general protection).
Other files that matched a text search for "provider" (Stage 1 organisations, requests, reviews, location code) use the word for **service providers or location providers** and are unrelated.

## 3. Classification of Stage 2A components

| Component | Class | Decision |
|---|---|---|
| `lib/*` auth guards (`requireAuth`, `requireVerified`, `requireActiveSuperAdmin`), audit, validate | 1. Reusable as is | Unchanged. |
| `ai/sanitize.js`, `ai/geo.js`, `ai/log.js`, `ai/errors.js`, `ai/constants.js` | 1. Reusable as is | Kept (log allow-list gains a few engine counters). |
| `ai/tools/data.js` (allow-listed public reads, `isActive` and organisation checks) | 2. Reuse after modification | Kept; moved to `ai/retrieval/`; adds a truncation flag so a capped scan is reported honestly. |
| `ai/tools/normalize.js` (record shaping, price/hours parsing) | 2. Reuse after modification | Kept; moved; field names tightened to the ones the app proves (section 5). |
| `ai/tools/cards.js` (cards rebuilt from the database) | 2. Reuse after modification | Kept; moved. |
| `ai/conversations.js` (owner-only storage, idempotency, deletion) | 2. Reuse after modification | Kept; adds a small bounded `context` object on the conversation document so follow-ups work. No new collection. |
| `ai/usage.js` per-user daily and burst limits, in-flight tracking | 2. Reuse after modification | Becomes `ai/ratelimit.js`: same transactional logic, without money, tokens, budget or breaker. |
| `ai/config.js` | 2. Reuse after modification | Models, prices, effort, output tokens, budget, loop caps removed; limits, retention, languages, cache kept. |
| `ai/language.js` | 2. Reuse after modification | Kept; English templates only; isiZulu detected and answered in English with a notice (not claimed). |
| `handlers/ai.js` | 2. Reuse after modification | Same callables minus the breaker; no secret. |
| `ai/grounding.js` | 4. Unnecessary | It validates untrusted model prose. Our answers are composed from records, so grounding is by construction. Its checks (booking wording, availability, travel time) are replaced by a composer that cannot emit those claims, with tests. |
| `ai/tools/registry.js`, `tools/schema.js` | 3. Provider-dependent | The model-facing tool layer is removed. Its useful logic (scoring, filtering, knowledge search, bookable check) is re-implemented deterministically in the engine and retrieval modules. |
| `ai/providers/*`, `secrets.js`, `prompt.js`, `cost.js` | 3. Provider-dependent | Removed. |
| `ai/chat.js` | 3. Provider-dependent | Rewritten around the engine. |
| Global usage document, budget thresholds, circuit breaker, `aiAdminSetBreaker` | 4. Unnecessary | Existed only to control paid API spend. Removing the global document also removes the single hot document identified in the Stage 2A report. A kill switch remains (`enabled` config, Super Admin only). |
| Firestore rules and index for AI collections | 1. Reusable as is | Unchanged. `ai-usage` now holds only per-user day documents. |

## 4. Security properties that are retained

* Authenticated and verified email for every AI callable.
* Server-only access: clients cannot read or write `ai-conversations`, `ai-usage`, `ai-config`.
* Conversations are owner-only; a foreign id behaves like a missing one.
* Retrieval reads only the fixed public collection allow-list, only `isActive == true`, only published listings, and hides records of unapproved or inactive organisations. No tool or engine code can name a collection from user input.
* Review text is never read; only the aggregate rating that Stage 1 `submitReview` maintains.
* Input is validated, sanitised and bounded; logs contain no message content, answers or coordinates.
* Location is optional, transient and never stored.
* Booking: the engine can only say a listing accepts booking requests and point the user to the in-app request; it never creates a booking.

## 5. Collections and fields supported by repository evidence

Public collections the app already reads and the rules already allow (`utils/publicContent.js`, `security-rules/firestore.rules`):
`accommodations, attractions, business, restaurants, recreation, events, news, announcements, transport, healthcare, emergency, publicservice, homescreen, xplore-menu, loadshedding`.
The engine will read only: `accommodations, restaurants, attractions, recreation, business, healthcare, publicservice` (listings), `events`, `news`, `announcements`, `emergency`, `transport`, `loadshedding`, and `homescreen` (documents with `type: "township"` for the township guide).

Fields **proven by the app screens** (`components/xplorescreens/*`, `screens/Events.js`): `name, location, type, images, rating, reviews, description, hours / openingHours, cuisine, specialDishes, tags, activities, entryFee, duration, ageRestriction, coordinates, phone, email, availability, status, price, priceNum` (accommodation), `fare, destination, origin, routeName, stops, frequency, days, departures, mode, operator` (transport), plus `isActive` everywhere. Stage 1 adds `organisationId`, `listingStatus`, `ratingCount`, `ratingSum`, `rating`, `reviews` (aggregates maintained by `submitReview`).

**Not supported by repository evidence, so the engine will not pretend otherwise:**
* There is **no** `tours`, `tour-guides` or `itineraries` collection (the Stage 1 data-model document lists them as "not created"). The tour and tour-guide intents will therefore search existing `business`, `attraction` and `recreation` records for the words "tour" and "guide" in their stored text, and say plainly when nothing matches.
* There is **no** verified availability data, so the engine never states availability.
* Activity **durations** exist only on `recreation` (`duration`), as free text. **Travel times** do not exist. Opening hours are free text; only two unambiguous patterns are interpreted (existing, tested rule).
* How completely live documents populate these fields **cannot be known from the repository**. The engine reports missing fields on every result instead of assuming.

## 6. Cost profile of the existing retrieval layer (the weakness to fix)

The Stage 2A loader reads up to 200 active documents of a collection and filters them in memory, with a 60 s per-instance cache, and one organisation read per distinct organisation. Without a cache, a single plan-a-trip message touching four categories could cost several hundred reads. Firestore has no full-text search. The plan for Stage 2B, without a schema change:

* keep an in-memory, per-instance cache (config, default 300 s) so repeated questions do not re-read;
* cap each category scan (default 150 documents) and **tell the user when a category was capped**;
* read only the categories an intent needs (not all collections);
* no cross-collection scans, no whole-collection search for single-entity questions when a name hit narrows the category;
* document the optional later improvement (a precomputed `searchText` / keyword field written by the CMS or a Cloud Function) as a **proposal only**; it needs a schema decision and is not introduced silently.

## 7. Proposed module structure

```
functions/src/ai/
  config.js  constants.js  errors.js  sanitize.js  geo.js  log.js  language.js     (reused)
  ratelimit.js                         per-user daily + burst limits (from usage.js)
  conversations.js                     owner-only history + bounded context (reused)
  retrieval/  data.js normalize.js cards.js index.js   public-only reads, cache, truncation
  engine/
    lexicon.js     words, synonyms, categories, interests (data, no logic)
    intents.js     extensible intent registry and detection
    entities.js    budget, currency, date, time, party size, interests, categories, place
    context.js     merges follow-up context
    ranking.js     deterministic, explainable scoring (no paid placement)
    itinerary.js   half-day, full-day, multi-day from verified records, with caveats
    compose.js     response blocks from templates (English locale; others pluggable)
    locales/en.js  all wording in one place
    engine.js      detect, extract, clarify or retrieve, rank, compose
  chat.js                              validate, rate-limit, context, engine, persist
functions/src/handlers/ai.js           callables (no secret, plain wrapper)
```

## 8. Decisions that need your input (defaults chosen, all reversible in config)

1. **Message limits.** The Stage 2A limit of 10 per day existed to control paid spend. With no paid API, I propose 50 per day and 5 per minute to protect Firestore reads, adjustable without redeploy. Your earlier numbers remain easy to restore.
2. **Kill switch.** With the budget breaker gone, the Super Admin kill switch is the `enabled` setting through `aiAdminUpdateConfig`.
3. **Callable names** stay `aiChat`, `aiGetUsage`, `aiListConversations`, `aiGetConversation`, `aiDeleteConversation`, `aiDeleteAllMyAiData`, `aiAdminGetUsage`, `aiAdminUpdateConfig` for continuity (nothing is deployed or consumed yet). `aiAdminSetBreaker` is removed.
