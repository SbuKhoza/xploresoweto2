> **SUPERSEDED (Stage 2B).** This document describes the Stage 2A design that called a paid external language-model API. That architecture was **withdrawn**: Stage 2B replaced it with a database-powered engine that needs **no** API key, secret or paid AI service. Nothing below is part of the current system, and **none of the setup, key-creation or deployment instructions in it should be followed**. It is kept only as history. Current documents: `README.md` in this folder.

# Stage 2A review report: AI backend

Branch `stage2a/ai-backend`, created from `stage1/firebase-transition` at the confirmed start commit `ab20e088752dad6d9ce8ba93c23a0330fccb0a7b`.
Seven local commits. **Nothing has been deployed, no production Firebase setting was touched, and nothing was pushed.** Stage 2B has not been started.

## 1. Result in one paragraph

The AI backend is built and passes its automated tests: **206 of 206** (93 existing Stage 1 tests, unchanged and still passing, plus 113 new).
It is a provider-neutral chat service with an Anthropic adapter, server-side usage limits and a budget circuit breaker, owner-only conversation storage,
eleven read-only retrieval tools, and a grounding validator that removes claims the database does not support. What has **not** been done is just as important:
it has never called the real Anthropic API, the Firestore rules tests could not be run (the emulator cannot be downloaded in this environment), and nothing has run on Firebase.
See sections 6 and 7 before relying on any of it.

## 2. What was built

| Area | What it does | Where |
|---|---|---|
| Provider abstraction | One interface (`generate`) returning text, tool calls, stop reason, token usage; vendor errors normalised to `ProviderError`. Adding a provider is one adapter file plus one registry line. | `src/ai/providers/` |
| Anthropic integration | Verified model ids `claude-haiku-5-5` (routine) and `claude-sonnet-5-5` (planning). Never sends `temperature`, `top_p`, `top_k` or `tool_choice`; effort via `output_config.effort`; SDK retries off (our code owns retries). | `providers/anthropic.js`, `docs/stage2/VERIFICATION_RECORD.md` |
| Secret Manager | `defineSecret("ANTHROPIC_API_KEY")`, bound to `aiChat` only, read in exactly one place. | `secrets.js`, `functions/index.js` |
| Usage limits | 10 messages per user per SAST day, 3 per minute burst, all configurable. Enforced inside Firestore transactions with reservations, so parallel requests cannot bypass them. | `usage.js` |
| Budget and breaker | US$50 monthly. Worst-case cost is reserved before each call and settled to actual afterwards. 50% and 80% thresholds audited once. At 100% a latched global breaker refuses requests. Super Admin can trip or reset it. | `usage.js`, `handlers/ai.js` |
| Conversation storage | Owner-only; a foreign id behaves exactly like a missing id. Idempotent by request id. 90-day `expireAt`. User can delete one conversation or all AI data; usage counters are kept so deletion cannot reset a limit. | `conversations.js` |
| Retrieval tools (11) | `searchListings, getListing, getListingRating, searchEvents, getAnnouncements, getNews, getEmergencyServices, getTransport, getLoadshedding, searchKnowledge, checkBookable`. All read-only, closed argument schemas, collections chosen from an enum, active records only, suspended organisations hidden, results capped, text sanitised and wrapped as untrusted data. | `tools/` |
| Grounding validator | Treats the model's JSON as an untrusted proposal. Re-derives the four labels, strips unsupported prices, hours, availability claims, booking confirmations and travel times, removes named listings no tool returned, restricts cards and booking offers to this turn's evidence. | `grounding.js` |
| Orchestrator | validate, idempotency check, reserve, history, bounded tool loop (5 iterations, 8 tool calls, final call without tools, 70 s deadline), grounding, persist, settle. Provider outage refunds the daily message (not the burst slot). | `chat.js` |
| Languages | English and isiZulu detection and reply instruction. isiZulu is flagged `verified:false` and the response carries a "still being tested" notice. Other languages can be added in config. | `language.js`, `config.js` |
| Callables (9, all `africa-south1`) | `aiChat, aiGetUsage, aiListConversations, aiGetConversation, aiDeleteConversation, aiDeleteAllMyAiData` (verified email required) and `aiAdminGetUsage, aiAdminSetBreaker, aiAdminUpdateConfig` (active Super Admin only, audited). | `handlers/ai.js` |
| Firestore rules and index | Explicit deny-all for `ai-conversations` (and `messages`), `ai-usage`, `ai-config`; one composite index. | `security-rules/` |

## 3. How your decisions were applied

| Decision | Implementation |
|---|---|
| Verified email and auth | Every AI callable calls `requireAuth` then `requireVerified`; tested for anonymous and unverified. |
| 10/day, 3/min, configurable, server-side, transactional | `usage.reserve` transaction; defaults in `config.js`; runtime override in `ai-config/default`, validated and bounded; test with 8 parallel requests and a limit of 3 gives exactly 3 successes. |
| US$50, monitoring, alerts, breaker | See table above. **Alerts are audit and log entries, not emails** (section 7). |
| No tiers or payments | None built. |
| Haiku routine, Sonnet planning | Keyword routing (`planningKeywords`, includes isiZulu planning words). Both model ids, prices and effort are config. |
| Verify models, params, prices | `VERIFICATION_RECORD.md`. One correction to my own Stage 2 assessment: Sonnet 5.5 cache-read is $0.10 per million tokens, not the $0.20 I quoted from a search snippet. |
| Four-way labelling | Block types `verified`, `knowledge`, `general`, `unverified`. A label is downgraded if its cited evidence does not earn it. Knowledge blocks carry their source title. |
| `homescreen` as first knowledge source | `searchKnowledge` reads only active `homescreen` documents of type township and cites "XploreSoweto township guide". No SAHO or other external content is used. |
| Straight-line distance only, no invented times | Only tool-computed `approxKm`; every response using it carries the "approximate straight-line distance, not driving distance or travel time" note; travel-time sentences are stripped. |
| Location optional, off by default, transient | Only present if the request includes it; held in memory for that request; test asserts it appears nowhere in the database, logs or provider messages. The model is told only whether location was shared. |
| 90-day retention, user deletion, TTL as backup | `expireAt` on every conversation, message and usage document. **The TTL policy is not configured** (needs your approval; command in the setup guide). |
| Aggregated ratings only | Tools read only the `rating`/`ratingCount` fields Stage 1 `submitReview` already maintains on the listing. The `reviews` collection is never read; a leak test seeds review text and asserts it never appears. |
| Logs free of content | Logging is an allow-list of scalar fields; user ids are hashed; test asserts no message, answer, tool data, email or coordinates in logs, including on failures. |
| English and isiZulu, no unproven claim | isiZulu is `verified:false` until quality tests pass; see limitation on its filtering in section 7. |
| Provider-facing AI deferred | Not built. |
| Booking requests only | The assistant can only call `checkBookable` (read-only) and offer a **request**; it can never create one. The app must call the existing `createBookingRequest` after the user explicitly confirms (Stage 2B). Confirmation wording is stripped. |
| Rules, owner-only, server-only usage | Section 2. Stricter than "owner can read": clients cannot read AI collections at all. |
| Prompt injection and tool boundary tests | Section 5. |
| Stage 1 protected, `africa-south1`, no Storage deploy, no bare deploy, explicit targets | See section 8. |

## 4. Files changed and why

**Existing files modified (all additive):**

| File | Change |
|---|---|
| `functions/index.js` | Imports the secret and the AI handlers; adds `wrapChat` (secret bound, 90 s timeout, 512 MiB) and 9 new exports. The 21 Stage 1 exports are unchanged. |
| `functions/package.json`, `package-lock.json` | Adds `@anthropic-ai/sdk` (installed 1.11.0). npm also reformatted the `engines` line; no value changed. |
| `.gitignore` | Ignores `functions/.secret.local` and `functions/.secret.*`. |
| `security-rules/firestore.rules` | Three explicit deny-all blocks for the AI collections. No existing rule changed. |
| `security-rules/firestore.indexes.json` | One composite index: `ai-conversations` by `ownerUid` then `updatedAt` descending. |
| `security-rules/test/firestore.rules.test.js` | New describe block: no client can read, list or write any AI document. **Written, not run.** |
| `functions/test/fake.js` | Test-only: added `orderBy`, nested collections, delete, and a higher transaction retry cap, so AI code could be tested. Stage 1 tests still pass against it. |

**New files:**

| File | Purpose |
|---|---|
| `docs/stage2/VERIFICATION_RECORD.md` | What was verified about models, prices and parameters, and when. |
| `docs/stage2/STAGE2A_SETUP_AND_DEPLOYMENT.md` | Secret setup (local and production), spend backstops, explicit-target deploy order, kill switch, rollback. |
| `docs/stage2/STAGE2A_REVIEW_REPORT.md` | This report. |
| `functions/src/ai/constants.js`, `config.js`, `errors.js`, `secrets.js` | Names and collections; validated runtime config; error types; secret binding. |
| `functions/src/ai/cost.js`, `usage.js` | Pricing arithmetic; transactional limits, budget and breaker. |
| `functions/src/ai/conversations.js` | Owner-only storage, history, deletion. |
| `functions/src/ai/log.js`, `sanitize.js`, `geo.js` | Content-free logging; untrusted-text cleaning; straight-line distance. |
| `functions/src/ai/providers/index.js`, `anthropic.js` | Provider registry; Anthropic adapter. |
| `functions/src/ai/tools/{schema,normalize,data,registry,cards}.js` | Argument validation; record shaping; the only Firestore access for tools; the 11 tools; server-built cards. |
| `functions/src/ai/prompt.js`, `language.js`, `grounding.js`, `chat.js` | System prompt; language detection; answer validator; orchestrator. |
| `functions/src/handlers/ai.js` | The 9 callables. |
| `functions/test/ai_*.test.js` (7 files) and `ai_helpers.js` | The new tests (section 5). |

No patch file, Storage rule, app screen, `package.json` of the app, XploreCMS file or Stage 1 source file was changed or removed.

## 5. Testing

Run with `cd functions && npm test`: **206 tests, 206 passing** at the final commit. The Stage 1 rules lint (`cd security-rules && npm run lint`) is clean.

New tests (113) by area:
* Foundation (42): config validation, cost arithmetic, adapter request shape, error normalisation, usage limits, races, stale reservations, conversation ownership, idempotency, deletion.
* Tools (19): exact tool surface, closed schemas, no write verbs, private-data leak scan over 12 markers, inactive and suspended-organisation hiding, size caps, timeout and generic failure, card hydration, empty database.
* Grounding (15): each stripping rule, label downgrades, card and booking-offer limits, malformed output, bounds, language detection.
* End to end (26): happy path; anonymous and unverified; input validation; daily, burst and parallel limits; runtime config; retried request ids; outage refund; retry bound; non-retryable failures without leaks; loop caps; deadline; breaker and admin reset; budget thresholds once; routing; languages; disabled; injection through listing and news text; booking integrity; hallucination; empty database; location privacy; conversation isolation and delete-all; log content; admin authorisation, validation and audit.
* Static security (11): no key-shaped string in the repo, ignored secret files, no Anthropic reference in client code, secret read once and bound to `aiChat` only, every callable authenticates, SDK imported in one file, tools have no write calls, log allow-list, rules deny-all for AI collections, index present, prompt keeps its rules.

During the work, tests found and I fixed: a crash in the validator's malformed-output path, and a test-isolation bug where one test left a tool function undefined. Several failures were wrong test expectations; each was diagnosed before changing the test.

## 6. What was NOT run or verified

1. **No real Anthropic call.** Everything used a scripted provider and a fake client. Whether the live models reliably produce the required JSON, call the right tools, and follow the prompt is unknown. If they emit non-JSON, the validator shows the text as filtered "general" content rather than failing, but answer quality would suffer. This is the largest remaining risk.
2. **Firestore rules were linted, not executed.** The emulator download is blocked here, so the new rules tests (and the Stage 1 rules tests) did not run. Please run `cd security-rules && npm test` on your machine.
3. **No Firebase emulator or deployment run** of the functions. `index.js` loads and registers the 9 functions, which is all that was checked.
4. **Concurrency was tested against an in-memory fake** that models transaction conflicts, not real Firestore contention or latency.
5. **Costs are estimates.** Typical cost is about $0.001 per routine message and about $0.02 per planning message, from assumed token counts (not measured); worst-case reservations are about $0.01 (Haiku) and $0.33 (Sonnet). Actual usage will be measured only with real calls.
6. **isiZulu quality, and any other language, is untested.**
7. **TTL policy, index and rules are not deployed**; the Anthropic secret does not exist in production.

## 7. Known limitations and risks (for your review)

* **Grounding is a safety net, not a proof.** Prices are checked as numbers against the cited evidence, so a real number attached to the wrong thing passes. Opening hours are checked permissively (any hour mentioned in the evidence counts). A listing the model names but does not declare in `mentions` is not detected by name. The availability, booking and travel-time filters are **English phrase patterns**: an isiZulu booking confirmation or availability claim would not be caught. Prices and clock times are language-neutral. This is why isiZulu stays unverified; I recommend a native-speaker test set in 2E before enabling it widely.
* **Hot document.** Every chat writes the single global usage document twice (reserve and settle). Firestore sustains roughly one write per second per document, with contention retries beyond that. This is fine at launch volumes (hundreds of messages a day) but would degrade at sustained traffic above about 0.5 requests per second. Sharded counters are the fix; I suggest 2E.
* **Budget alerts are not notifications.** Thresholds write audit and log entries; emails need a Cloud Logging alert or a Billing budget (not configured). The in-app spend is computed from the price table; the Anthropic invoice is authoritative, hence the recommended Console spend limit.
* **Planning reservation of about $0.33** means that in the last cents of a monthly budget planning requests are refused slightly before routine ones.
* **User text goes to Anthropic.** What users type is sent to the provider, and the answer is stored for 90 days. Location coordinates and individual reviews are not sent, but a user can type anything. Your privacy notice should say so.
* **App Check** is not enforced (same Stage 1 position); per-user limits apply, but a stolen account could spend that user's 10 messages.
* **In-flight duplicates:** a second tap on the same request id while the first runs gets `request-in-progress`.
* **History** sent to the model is bounded (12 messages / 6000 characters); `aiGetConversation` returns at most 100 messages.
* **Pre-existing:** `npm audit` reports 8 moderate advisories in the functions dependencies (via `uuid` in Firebase packages); the untouched Stage 1 baseline reports 9. None come from the Anthropic SDK.
* **Rules file scope:** `security-rules/firestore.rules` also holds the Stage 1 rules. Deploying it publishes both. This is your call, not mine.

## 8. Your restrictions, checked

| Restriction | Status |
|---|---|
| No functions, Firestore rules or Storage rules deployed without approval | Nothing deployed. |
| No production Firebase settings modified or deployed | None touched. Firebase project unchanged. |
| No Storage rules in Stage 2 | `storage.rules` untouched. |
| No unrestricted `firebase deploy`; explicit project and targets | Guide uses `--project xploresoweto --only …` throughout and explains why. |
| `africa-south1` for all new functions | They use the shared `opts.region`; a test asserts no other region in `index.js`. |
| Patch files and housekeeping | The ten root patch files are untouched; no unrelated cleanup. |
| Stage 1 behaviour unchanged | Existing 93 tests pass; only additive edits to existing files. |
| API key never in client code | Enforced by tests (section 5). |
| Report every changed file | Section 4. |
| Anthropic secret guide | `STAGE2A_SETUP_AND_DEPLOYMENT.md`. |

## 9. Decisions and approvals I need before Stage 2B

1. Review this report and the branch. Delivery: a git bundle and patch series are provided alongside this report; I have not pushed the branch. Tell me if you want me to push it.
2. Do you want me to run the real-model checks (a few dozen scripted conversations on a staging key with a low spend limit) as the first step of 2B, or will you provide a key and run them yourself?
3. Approval and timing to deploy rules, index, functions and the secret (guide section 5), and whether Stage 1 rules should go out in the same rules deploy.
4. Alert delivery: do you want a Cloud Logging alert policy for the 50%, 80% and breaker events, and to whom?
5. Confirmation that the 2B screen may call the existing `createBookingRequest` only after an explicit "Send request" tap on a confirmation panel that shows the listing, dates and guests.

Stage 2B (the conversational screen, Home entry, history, suggested prompts, cards and error handling) will not start until you say so.
