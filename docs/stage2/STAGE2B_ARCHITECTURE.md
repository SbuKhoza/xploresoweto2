# Stage 2B architecture: database-powered assistant

Status: **implemented and unit-tested locally; not deployed.** Branch `stage2b/database-ai`.

## 1. What it is, and what it is not

* It **is** deterministic code that reads approved, published public records from Firestore and composes answers from fixed templates. The same records and the same message give the same answer.
* It **is not** a language model, and it does not "understand" free language the way one does. Unrecognised requests get a clarification or an "I'm not sure" answer, never a made-up one.
* It calls no external AI service. A test fails if an LLM SDK, key, secret, `fetch`, `http(s)` or socket appears in the AI code.

## 2. Request flow

```
aiChat (callable, verified email)           handlers/ai.js
  validate + sanitise input                  ai/chat.js
  idempotency (stored reply for requestId)   ai/conversations.js
  per-user rate limit (transaction)          ai/ratelimit.js
  engine.respond(message, context, location)
     detect language (en; isiZulu detected, answered in English with a notice)
     detect intents -> extract entities -> merge follow-up context
     route: emergency | events | plan/itinerary | compare | ask about a place / booking | tours | find by category | knowledge
     retrieve (public, allow-listed, bounded, cached)  ai/retrieval/*
     filter + rank (explainable)                        engine/ranking.js
     itinerary (pure)                                   engine/itinerary.js
     compose from templates                             engine/compose.js + locales/en.js
  cards built from the retrieved records
  persist turn (owner-only) + bounded context
  settle rate-limit reservation (refund on internal error)
```

## 3. Module responsibilities

| Module | Responsibility |
|---|---|
| `handlers/ai.js` | The callables; authentication, ownership and Super Admin checks |
| `ai/chat.js` | Validation, idempotency, rate limiting, calling the engine, persisting, building cards |
| `ai/ratelimit.js` | Per-user daily and burst limits inside Firestore transactions. Counters only |
| `ai/conversations.js` | Owner-only history, bounded follow-up `context`, deletion |
| `ai/config.js` | Limits, retention, languages, cache and retrieval caps; kill switch `enabled` |
| `ai/engine/lexicon.js` | Words and synonyms as data: categories, interests, experience styles, weekdays, months |
| `ai/engine/intents.js` | Weighted pattern registry; `registerIntent` adds intents without touching the detector |
| `ai/engine/entities.js` | Budget (rand only), party size, dates (South African time), time of day, duration, categories, interests, constraints, known places |
| `ai/engine/context.js` | Merges follow-up values; re-validates stored context; reports what was carried over |
| `ai/engine/ranking.js` | Hard filters and weighted, explainable scoring; no paid placement |
| `ai/engine/itinerary.js` | Half-day, full-day and multi-day plans from ranked records; budget fitting; caveats |
| `ai/engine/compose.js`, `locales/en.js` | Response blocks and all English wording (one place) |
| `ai/engine/safety.js` | Removes availability, booking-confirmation and travel-time claims from database free text before it is quoted |
| `ai/engine/engine.js` | The pipeline and routing |
| `ai/retrieval/data.js` | The only Firestore access: allow-list, `isActive`, published, approved organisation, scan cap, cache |
| `ai/retrieval/listings.js` | Loads a category into searchable items; recognises a place named in a message |
| `ai/retrieval/queries.js` | Read-only queries used by the engine for events, emergency numbers and the township guide; others retained (news, announcements, transport, load-shedding, listing lookup, bookable check) but **no intent routes to them yet** |
| `ai/retrieval/normalize.js`, `cards.js` | Record shaping (price and hours parsing) and cards rebuilt from records |

## 4. Supported intents

Implemented and tested: find attractions, restaurants, accommodation, local businesses, events; tour guides and tours (see limits); discover things to do; recommend; compare; plan a trip; build an itinerary; ask about a place (about, price, opening hours, services, directions); booking request (points to the in-app request only); emergency numbers; greeting, thanks, help. Registered intent ids are listed by `knownIntents()` in `intents.js`.

Not implemented: public transport routes, load-shedding, news and announcements questions (the query code exists but no intent routes to it); healthcare and public-service searches by intent (the categories exist in the lexicon and are readable, but only visitor categories are searched by default); languages other than English.

## 5. Collections and fields actually used (read only)

All reads go through `retrieval/data.js`, which throws for any collection not on this list (tested).

| Collection | Used for | Fields read |
|---|---|---|
| `restaurants`, `accommodations`, `attractions`, `recreation`, `business` (also `healthcare`, `publicservice` readable) | Listings | `isActive`, `listingStatus`, `organisationId`, `name`/`title`, `type`/`category`/`cuisine`, `description`/`about`/`summary`, `location`/`address`, `price`/`entryFee`/`fare`/`priceRange`/`cost`, `openingHours`/`hours`/`operatingHours`, `rating`, `ratingCount`/`reviews`, `images`/`image`/`imageUrl`, `coordinates`/`coords`, `phone`, `website` (host only), `accessibility` (boolean), and string arrays `tags`, `specialDishes`, `activities`, `features`, `amenities`, `specialties`, `services` |
| `organisations` | Only `approvalStatus` and `active`, to hide records of unapproved or inactive organisations. No content is returned | `approvalStatus`, `active` |
| `events` | Upcoming events | `isActive`, `title`/`name`, `date`/`startDate`/`eventDate`, `time`, `location`/`venue`, `category`, `description`, image |
| `emergency` | Emergency numbers | `isActive`, `name`, `number`, `type`, `category`, `order` |
| `homescreen` | The township guide (documents with `type: "township"`) | `name`/`title`, `overview`/`description`/`about`, `history`, `people`, `landmarks`, `facts`, `established`, `namedAfter` |
| `ai-conversations` (+`messages`), `ai-usage`, `ai-config` | The assistant's own server-only data | owner-only; clients cannot read or write them (explicit deny rules) |

Fields that are **not proven** by the repository (`features`, `amenities`, `specialties`, `services`, `priceRange`, `cost`, `operatingHours`, `coords`, `venue`) are read defensively if present and ignored if absent. **How completely live documents fill these fields cannot be known from the repository**; every result states what is missing instead of assuming. Review text is never read: only the aggregate `rating` and count.

No new Firestore collection was created. The only schema addition is a `context` field and an `engine` label on the owner-only `ai-conversations` document.

## 6. Public-data retrieval rules

1. Collections only from the fixed allow-list in `constants.js`; the user's text cannot name one.
2. Only `isActive == true`; a `listingStatus` other than `published` is hidden; records linked to a non-approved or inactive organisation are hidden.
3. No private data is reachable: users, bookings, applications, organisation records, reviews text, admin and audit collections are not on the list.
4. Each category scan is capped (`retrieval.scanLimit`, default 150). If the cap is reached the answer **says it may have missed records**.
5. Single-record questions read only the categories they need, and prefer the records shown in the previous answer.
6. Free text from the database is cleaned before it is quoted (`safety.js`).

## 7. Ranking

Named factors, each with a reason shown to the user: text match (name > category/tags > description), interest match (with synonyms), area match, listed price within budget, rating (Bayesian average so one 5-star review cannot beat many good ones), straight-line distance (only if the user shared a location and the record has coordinates). Missing price, rating, hours or coordinates score zero and are flagged, never guessed. Ties break by name. **Nothing about who owns, pays for or promotes a listing is read** (a test checks the source and the behaviour). Weights are in `ranking.js` (`WEIGHTS`).

## 8. Itineraries

Built from ranked records: a morning activity, a midday meal and an afternoon activity per day, up to 5 days, no repeats. Budget fitting uses **listed** prices only (the lowest figure of a range) and removes the priciest stops; an unknown price is never treated as free. The itinerary always says: travel times cannot be verified, opening hours that could not be checked, prices that are missing, and that the listings do not say whether prices are per person. It is labelled `feasibility: "unverified"`. Straight-line gaps appear only when both records have coordinates.

## 9. Response generation

Fixed templates, filled only with retrieved values. Blocks are labelled for the app: `verified` (straight from a record), `suggestion` (the engine's ranking and plan), `knowledge` (township guide text with its source), `unverified` (what could not be confirmed, assumptions, limits), `general` (only the national emergency numbers fallback, labelled as not from XploreSoweto records). The wording never states availability, a confirmed booking or a travel time (tested over the locale file and a battery of messages). Follow-up suggestions and clarification questions are templated.

## 10. Security

Verified email for every callable; server-only conversation, usage and config collections; owner-only conversations (a foreign id looks like a missing one); input validated and sanitised; logs carry no message text, records or location; location is optional, transient and never stored; the engine never creates a booking (it can only point to the existing in-app booking *request*); Super Admin kill switch `enabled` and editable limits, validated and audited; no secrets exist. Firestore rules are unchanged from Stage 2A.

## 11. Limitations (honest list)

* Rule-based: it handles the phrasings and words in `lexicon.js`/`intents.js`; unusual wording may be misread or not understood. English only. isiZulu is detected and answered in English with a notice; it is **not** supported.
* There is no `tours`, `tour-guides` or `itineraries` collection. Tour and guide questions search the words "tour"/"guide" in existing records and say so.
* No availability, no live data, no travel times, no per-person pricing information. Hours are free text; only two unambiguous patterns are interpreted for "open now", otherwise it says it cannot tell.
* Category search is an in-memory scan of up to the cap; there is no full-text search. A `searchText`/keyword field written by the CMS would improve this: **proposal only, needs your decision, not implemented**.
* Distances are straight-line and approximate.
* Cards, prices and hours are only as complete and current as the CMS records.
* Quality against real CMS data is **untested**: tests use a small fictional dataset in an in-memory fake.
