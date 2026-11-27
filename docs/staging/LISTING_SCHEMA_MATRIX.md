# Listing schema compatibility matrix (XploreCMS ⇄ XploreSoweto)

Sources compared: mobile screens + `utils/listingData.js` (app, branch `fix/listing-stability`), CMS forms (`src/lib/schemas.js`, `buildPayload` in `SchemaForm.jsx`),
CMS sample definitions (`src/sampleData/fixtureListings.js`, `packs.js`), the restore engine (`src/sampleData/engine.js`), the app's staging seed definitions
(`functions/scripts/seed-staging.js`, `utils/townships.js`) and the backend submission/approval handler (`functions/src/handlers/listings.js`).
Machine-checked by `test/listingCompat.test.jsx` (this repo) and `functions/test/cms_compat.test.js` (app repo, against `docs/cms-schema-snapshot.json`).

Legend: **text** string · **n** number · **list** array of strings · **nums** array of numbers · **imgs** array of image URLs · **obj[]** array of objects · **coords** `{latitude, longitude}`.
"App" = what the mobile app accepts after normalisation (it also accepts older/legacy shapes, listed in the notes).

## Shared behaviour (all collections)

| Topic | CMS writes | Mobile app accepts | Result |
|---|---|---|---|
| Empty list fields | `[]` (blank rows removed by `buildPayload`) | array, missing, null, string, wrong types | OK. Missing/invalid → empty list; nothing invented |
| Empty numbers / coordinates | `null` | number, numeric string, missing, null, NaN | OK. Invalid → not shown |
| Images | array of URLs, may be empty | array of URL strings or `{url|uri|src}`; invalid entries dropped; none → placeholder | OK. **Images are optional everywhere** |
| Required CMS fields | identity fields only (`name` / `routeName` + `origin` + `destination` / `number`) | name missing → "Unnamed" style fallback | OK |
| Backend-approved listings | `images` always an array (may be `[]`); text, `tags`, `features`, `amenities`, `specialDishes`, `coordinates` only if submitted | all optional | OK; see gaps G1–G3 |

## Per collection

| Collection | Field | CMS form type | App reads as | Status |
|---|---|---|---|---|
| **restaurants** | name, cuisine, type, description, location, openingHours, availability | text/select | text | OK |
| | price | text (**added in this change**, optional) | text/number → "R…" | **Fixed**: app displayed `price`, CMS had no field (sample r1 and r6 carry one) |
| | rating, reviews | number | number 0–5 / count | OK |
| | specialDishes, tags | strings | list | OK (sample defs now `[]`) |
| | tableOptions | numbers (form default `[2,4,6,8]`) | positive ints; **empty → reservation blocked with a message** | OK. Backend-approved restaurants have none → not reservable until staff set sizes (G1) |
| | images, coordinates | imgs, coords | imgs, coords | OK |
| **accommodations** | name, type, description, location, availability, price | text | text; price text or number | OK (sample has extra `priceNum`: app ignores unless sort) |
| | maxGuests | number | positive int | OK |
| | amenities, images, coordinates, rating, reviews | strings, imgs, coords, number | same | OK |
| **recreation** | name, category, type, description, location, duration, ageRestriction, status, phone, email | text/select | text | OK |
| | entryFee | text | text/number; **falls back to legacy `price`** (sample rc1 uses `price`) | OK (alias documented) |
| | activities, images, coordinates, rating, reviews | strings, imgs, coords, number | same | OK |
| **attractions** | name, type, description, location, duration, bestTime, status | text/select | text | OK |
| | price | text | text/number; **falls back to `entryFee`** (sample a2) | OK (alias documented) |
| | openingHours | *no CMS field* | not displayed | Sample-only legacy key; harmless, not displayed (L1) |
| | features, images, coordinates, rating, reviews | strings, imgs, coords, number | same | OK |
| **business** | name, description, category, type, location, hours, status, phone, email | text/select | text | OK |
| | services | **objects** `{name, icon}` | objects with `name`/`icon`, plain strings, or invalid → dropped; icon default | OK. Objects preserved (not stringified) |
| | images, gallery.images | imgs | cover carousel = `images`; Gallery tab = `images` + `gallery.images` | OK |
| | logo, useTextLogo, organisationId | image/toggle/text | not read | CMS-only (documented) |
| **healthcare** | name, category, type, description, location, hours, status, insurance, phone, email | text | text | OK |
| | emergency | toggle | boolean-ish | OK |
| | specialties, images, coordinates, rating, reviews | strings, imgs, coords, number | same | OK |
| **publicservice** | name … hours, status, website, phone, email | text | text; website kept only if http(s) | OK |
| | accessibility | **text** | text: "No/None/Not …" is *not* accessible; boolean also accepted | **Fixed in app** (previously any text showed "Wheelchair accessible") |
| | emergency, services (list), images, coordinates, rating, reviews | toggle, strings, imgs, coords, number | same | OK |
| **emergency** | name, number, category, type (Public/Private), address, description, additionalInfo | text/select | text; `order` number | OK |
| **transport** | routeName, operator, origin, destination, frequency, fare, days, notice, status | text/select | text | OK |
| | mode | select (bus, train, taxi, …) | lower-cased text; **missing → "other"** (never defaulted to bus) | **Fixed in app** |
| | departures, stops | strings | list (strings, `{time}`, `{name}`); invalid entries dropped; no schedule invented | OK |

## Gaps, decisions and limitations

* **G1** The backend submission handler (`listings.js`) does not accept `tableOptions`; approved restaurants therefore have no table sizes. The app now shows "reservations are not available for this restaurant yet" and blocks the request instead of inventing sizes. Allowing staff to add sizes in the CMS (existing form field) fixes it per record. *Not changed* (Functions are not to be deployed in this task).
* **G2** The handler does not accept `services` (business), `activities`, `specialties`, `maxGuests`, `duration`, etc.; those are edited in the CMS after approval. Optional; the app treats them as empty.
* **G3** The handler requires text fields to be non-empty strings when present (`min: 1`); the CMS form writes `''` for blank text. CMS forms are not affected (they do not go through the handler).
* **L1** Fixture-only keys with no CMS field (`openingHours` on attractions/recreation/business, `priceNum`) are kept as-is for fidelity with the Malloya fixture.
* CMS restaurant form default `tableOptions: [2,4,6,8]` is a CMS convenience that the operator can edit; the app never invents sizes itself. Sample records carry **no** table sizes.
* `images: ['']` in form defaults is only form state; `buildPayload` removes blanks, so documents never store empty-string images (tested).

## Sample restore (create-only)

`runPack` lists existing ids and natural keys as a first filter, then writes with **one Firestore transaction per pack** that re-reads every target and sets only those that still do not exist. A record created or edited by someone else between the listing and the write (or by a second operator/tab restoring at the same moment) is therefore skipped, not overwritten; the transaction retries when a read document changes. Security rules cannot enforce create-only for staff (their `update` is allowed), so the safeguard lives in the engine. Tested in `test/sampleRestore.test.jsx` ("create-only restore under concurrency") with a transaction mock that models retry; this is **not** a test against a real Firestore.
