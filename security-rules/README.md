# Stage 1 security rules (PREPARED, NOT DEPLOYED)

`firestore.rules`, `storage.rules` and `firestore.indexes.json` are kept out of any `firebase.json`, so a stray `firebase deploy`
cannot publish them. `firebase.rules-test.json` exists only for emulator testing.

## Status (be precise)
| Check | Status |
|---|---|
| Syntax + Firebase's recommended lint (official ANTLR grammar via `@firebase/eslint-plugin-security-rules`) | **Passed** (`npm run lint`); the same linter rejects a deliberately broken file |
| Behaviour tests against the Firebase emulator (`test/*.test.js`, ~80 cases) | **Written, NOT run**: the emulator binaries cannot be downloaded in the environment that produced them. Run them locally before trusting the rules. |

## Run on your machine (from the repository root; Java 11+ required for the emulators)
```
npm install -g firebase-tools
npm --prefix security-rules install
npm --prefix security-rules run lint
npm --prefix security-rules test
```

## Things the emulator run must confirm (known uncertainties)
1. `organisation-members` list queries whose rule calls `get()` with a path built from `resource.data.organisationId`
   (the manager "list my organisation's members" query).
2. Storage rules make at most 2 cross-service Firestore lookups per request; `listing-submissions` read for staff stays within that.
3. Filtered public queries (`where("isActive","==",true)`) are accepted and unfiltered ones are rejected.

## Design
See `docs/stage1/ARCHITECTURE_AND_DATA_MODEL.md`. In short: default deny; public content readable only when `isActive == true` (except that active platform staff may read every document in the public-content allow-list, including inactive and flag-less ones, so the CMS can show and repair them)
(queries must filter); every sensitive write is a Cloud Function (Admin SDK bypasses rules); staff need claim + verified email +
active record; organisation access comes from membership documents that only functions write.
