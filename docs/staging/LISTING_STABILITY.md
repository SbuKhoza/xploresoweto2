# Listing stability (XploreSoweto staging)

## Root cause of the Android crash

`components/xplorescreens/Restaurants.js` (detail carousel, old lines 393 and 401) called `selectedRestaurant.images.map(...)`. The list card guarded with
`Array.isArray(item.images)`, the detail view did not. Staging restaurants written by `functions/scripts/seed-staging.js` and by the CMS sample restore (the
Malloya fixture records) **have no `images` field at all**, so `images` was `undefined` and opening any such restaurant threw
`TypeError: Cannot read property 'map' of undefined` inside `Restaurants`/`RestaurantsWithoutHeader`, which terminated the app (no error boundary existed).
Reproduced by `tests/ui/restaurants.test.jsx` against the old code ("Cannot read properties of undefined (reading 'map')"; 13 of 19 Business/Transport cases also failed on the old code).
The same unguarded pattern existed for Business (`images`, `services`), Transport (`stops`, `departures`, `mode`) and, in weaker forms, other screens.

## What changed

* `utils/listingData.js`: pure, schema-aware normalisers (per collection) used at the data boundary and in render. Never throws; valid and legacy shapes are kept (business service **objects** stay objects; `gallery.images`; attractions `price`/`entryFee`; restaurants `hours` → `openingHours`); invalid entries are dropped; nothing is invented (no hours, prices, table sizes, schedules or modes).
* All listing screens use the normalisers; `Chips`, `MetaCard`, `ExploreList`, detail and theme helpers validate their inputs; ExploreList keeps its placeholder and now validates each image entry.
* Restaurants: carousel/dots only for usable images, otherwise the existing teal placeholder with the type icon; reservations are allowed only when the restaurant lists valid table sizes, otherwise a message is shown and the request is blocked (also inside the reservation forms).
* Transport: a missing mode shows "other" (previously defaulted to bus). PublicService: accessibility text such as "No" is no longer shown as wheelchair accessible.
* `components/ListingErrorBoundary.js`: scoped safety net around each listing screen (not a substitute for the fixes); "Try again" remounts the screen; logs only `[listing] <screen> failed to render: <ErrorName>: <short message>`, never documents.
* Staging seed: restaurants now use `openingHours`. Admin tooling (not run): `functions/scripts/audit-listings.js` (read-only) and `repair-listings.js` (dry-run first).
* No security rules, indexes, Functions code, Malloya/Luna/AI configuration or dependencies were changed.

## Test inventory (what is real and what is simulated)

| Layer | Where | Nature |
|---|---|---|
| Normaliser and static guards | `functions/test/listing_data.test.js` (15) | Node, real code, no device |
| CMS ⇄ mobile compatibility | `functions/test/cms_compat.test.js` | Node; documents generated from the CMS snapshot |
| Audit / repair logic and guards | `functions/test/listing_audit.test.js` (9) | Node with an in-memory fake Firestore; scripts are **not** run against Firebase |
| Screen rendering and interaction (101) | `tests/ui` (`cd tests/ui && npm ci && npm test`) | **Simulated**: react-native-web + jsdom with stubs for native and Firebase modules. Not Hermes, not NativeWind styling, not a device |
| Security-rules lint | `security-rules` `npm run lint` | Real |
| Rules emulator tests | `security-rules` `npm test` | **Not run** (needs the Firebase emulator; no rules changed) |
| Android device / EAS build | — | **Not run.** Use the checklist below |

## Manual Android regression checklist (real device, staging build only after you build it)

For each, note pass/fail and device/OS.
1. Restaurants: open every restaurant, including sample ones with no images (placeholder shown, no dots, no crash) and one with 1 and with 3+ images (dots match image count, swipe works).
2. Restaurants: search, cuisine filter, price filter, open-now filter with records that lack hours; favourite and un-favourite; reopen from favourites.
3. Restaurants: Reserve on a restaurant **with** table sizes (form opens, request submits) and **without** (message shown, no form request possible).
4. Business: list, open a business with and without images/services; Overview, Services, Contact, Gallery tabs; add and read a review; average rating.
5. Transport: list with a route that has no mode, no stops, no departures; open each; stops and next departures render only when present.
6. Accommodation, Attraction, Recreation, Healthcare, PublicService, Emergency, Townships: open every record; directions button on a record with and without coordinates.
7. Public service with accessibility "No" shows no accessibility badge.
8. Force-close and reopen offline (cached data) and back online.
9. Confirm Malloya/Luna screens are unaffected and the app is on the staging project (about/diagnostics).
10. If a screen ever shows "Something went wrong showing this list", record which one, tap "Try again", and send `adb logcat | findstr "[listing]"` output.

## Proposed staging data repair (NOT executed)

Only needed if you want existing staging sample records to carry the empty lists the CMS saves; the app no longer needs it to avoid crashes.
```powershell
# 1. read-only audit (prints paths and field names only, never contents)
cd functions
node scripts/audit-listings.js --project xploresoweto-staging --out ..\audit.json
# 2. dry run: prints what would be added and a plan hash. Writes nothing.
node scripts/repair-listings.js --project xploresoweto-staging
# 3. only after you have reviewed the plan, explicitly approve THAT plan:
node scripts/repair-listings.js --project xploresoweto-staging --apply --approve-plan <hash>
```
Scope and safety: Application Default Credentials only; production refused; only documents marked `isSample`/`synthetic`; only adds absent/null empty lists and copies a restaurant's own `hours` into `openingHours`; never replaces, deletes or invents; the approval must equal the freshly computed plan hash; each write re-reads the document in a transaction.

## Integration and verification

```powershell
git fetch ..\xploresoweto-listing-stability.bundle fix/listing-stability:fix/listing-stability   # review, then merge into your staging branch
cd functions; npm ci; npm test                      # expect all pass
cd ..\security-rules; npm run lint
cd ..\tests\ui; npm ci; npm test                     # 101 simulated render tests
```
Then build the staging app yourself when ready (no EAS build was made) and run the checklist.
