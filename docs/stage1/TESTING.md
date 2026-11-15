# Stage 1 testing: what actually ran

## Ran in the build environment (results are real)
| Check | Result |
|---|---|
| Cloud Functions logic: 93 tests with an in-memory Admin SDK fake that models transactions (conflict retry, reads-before-writes), idempotency and concurrency (`cd functions && npm test`) | **93 pass** |
| Mutation check: 10 critical protections deliberately broken one at a time (claim-only admin, last-super-admin, invitation email match, manager escalation, provider confirming completion, review unlock, self-approval, profile overwrite, cross-organisation membership, tampered permissions) | the suite failed for **every** mutation (two gaps found and fixed first) |
| Security rules syntax + Firebase's recommended lint using Firebase's own ANTLR grammar (`security-rules`: `npm run lint`) | **pass**; the same linter rejects a deliberately broken file |
| Static analysis of every changed app file (parse + undefined identifiers + undefined JSX components) | **0 errors** |
| App-vs-rules-vs-backend consistency guard (collection lists equal; no users listing; no forbidden legacy patterns; Person-Of-Interest only behind its flag; role map equals the rules; region/project/runtime) | **pass**; fails if a forbidden pattern is reintroduced |
| Super-admin script guards (no uid, old project, key inside repo) | **pass** |

## NOT run (and why)
| Not run | Reason | What to do |
|---|---|---|
| **Firestore/Storage rules against the Firebase emulator** (`security-rules/test`, ~80 cases written) | The emulator binaries cannot be downloaded in the build environment (storage.googleapis.com is blocked). | Run on your machine (see below). **Until then the rules are syntax-checked but their behaviour is unverified.** |
| Callables against the Functions/Auth/Firestore emulators | same | optional integration step after the rules tests |
| The mobile app on a device/emulator | no device here | smoke-test the checklist below |
| Any deployment | not authorised | none |

## Run on your machine (repository root; Java 11+ for emulators)
```
npm install -g firebase-tools
cd functions && npm install && npm test            # 93 logic tests
cd .. && npm --prefix security-rules install
npm --prefix security-rules run lint               # rules syntax
npm --prefix security-rules test                   # emulator: rules behaviour (FIRST RUN: expect to review failures)
```
Rules behaviours the emulator run must confirm (known uncertainties): the manager "list organisation members" query (rule uses `get()` with a path from `resource.data`), the Storage rules' two-lookup limit for staff reads of `listing-submissions`, and that filtered public queries pass while unfiltered ones are rejected.

## Device smoke-test checklist (empty database, new project)
1. Fresh install: Splash → Authentication. No Google button; login field says "Email address"; registration has no username field.
2. Register → verification email arrives → alert shows success; app proceeds to enrollment (greeting, kasi only).
3. Kill the app/airplane mode during registration → relaunch: either enrollment or the "We couldn't finish setting up your account / Try again" screen; Try again succeeds; no second account needed.
4. Home with no content: bundled hero, no feed sections, "Township guides are coming soon".
5. Xplore shows the 10 built-in category tiles; every category opens its existing empty state.
6. Community: Events/News/Eskom only; no Person-Of-Interest card. Eskom: "No Data Available".
7. Business: "Hire" and reservation forms show "Online requests aren't available for this listing yet" for unlinked listings; unverified email shows the verify prompt.
8. Update over an old build: stale cache and old login are cleared once (no old-project content appears).
