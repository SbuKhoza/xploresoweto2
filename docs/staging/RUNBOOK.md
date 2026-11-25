# XploreSoweto staging: runbook

Staging is a second Firebase project, **`xploresoweto-staging`** (region `africa-south1`), with its own Auth users, Firestore, Storage and
Functions. It never holds production data and never holds a provider secret. Luna stays **off**; Malloya works deterministically.

All commands are **Windows PowerShell 5.1+**. Run them from the repository root, on a `staging/*` branch (`staging/base` is the long-lived
one; git cannot hold both `staging` and `staging/env-foundation`).

## 1. How isolation works (and what it does not do)

| Layer | What it stops | Where |
|---|---|---|
| Exact allow-list | Any project id that is not exactly `xploresoweto` or `xploresoweto-staging` | `config/environments.js`, `functions/scripts/lib/target.js` |
| Native identity | A build whose Android application id and configured environment disagree | `Firebase/env/validate.js` (runs before Firebase starts) |
| Field-by-field config check | Missing, swapped or altered apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId | same |
| Web | A staging config served from a production host, and the reverse | same (`identity.web.js`) |
| Build time | An EAS profile whose variables or Gradle flavor do not match | `scripts/verify-env.js` (EAS `eas-build-pre-install`) |
| Token audience | A session issued by another project (supplementary only) | `utils/persistAuth.js` |
| Functions | Staging: no secret declared or bound, 3 instances, Luna blocked at runtime | `functions/index.js`, `functions/src/lib/environment.js` |
| Deploy | Deploying staging from a non-staging branch, or production from a staging branch | `scripts/predeploy-guard.js` (functions), `deploy-staging.ps1` (all) |

What it does **not** do: it does not stop a person with Owner rights on both projects from running a raw `firebase deploy --only firestore`
or any `gcloud` command against production. See section 9.

## 2. Tools needed

Node 22, Git, the Firebase CLI (`npm i -g firebase-tools`), the Google Cloud CLI, a JDK (17+), Android SDK (for local builds), and for EAS
`npm i -g eas-cli`. Sign in with `firebase login` and `gcloud auth login` + `gcloud auth application-default login`.

## 3. Create the staging project (needs your separate approval; billing is linked here)

Nothing in this repository creates it automatically. First look at the plan (runs nothing):

```powershell
.\scripts\staging\new-staging-project.ps1 -BillingAccountId 000000-AAAAAA-BBBBBB
```

When you approve, run it for real (you will be asked to type the project id):

```powershell
.\scripts\staging\new-staging-project.ps1 -BillingAccountId 000000-AAAAAA-BBBBBB -Execute
```

`-BudgetUsd` (default 20) is an **alert** at 50%, 90% and 100%. It does not cap spending. The project id may already be taken (ids are global
and permanent): if `gcloud projects create` fails for that reason, stop and choose a new id in `config/environments.js`, `.firebaserc`,
`functions/src/lib/environment.js` and the scripts (a test fails until they all agree).

Then, in the Firebase console for `xploresoweto-staging`:
1. Authentication > Sign-in method: enable **Email/Password only**.
2. Storage > Get started: create the default bucket in **africa-south1** (the free quota covers US buckets only, so a few cents may be billed).
3. Project settings > Your apps > the **web app**: copy `apiKey`, `messagingSenderId` and `appId`; confirm `storageBucket`.
4. Commit them into `config/environments.js` (`staging.firebase`), then:

```powershell
node scripts/sync-eas-env.js          # rewrites the eas.json env blocks from config/environments.js
cd functions; npm test; cd ..         # every test must still pass
```

Until step 4 is done, staging builds **fail closed** by design (`verify-env` and the app refuse to start).

## 4. Deploy staging (rules, indexes, functions)

```powershell
.\scripts\staging\deploy-staging.ps1 -What all -DryRun     # shows exactly what would run
.\scripts\staging\deploy-staging.ps1 -What all             # asks you to type xploresoweto-staging
.\scripts\staging\verify-staging.ps1                       # read-only: 30 functions, no secrets, max 3 instances
```

The script pins the project literally, clears ambient project variables, runs `scripts/staging/guard.js` (branch and clean tree), generates
the function manifest **offline** and checks it, and never uses `--force`. The Luna functions are all deployed; `aiChat` has no secret
binding in staging, so it deploys without any key. **Do not run `firebase functions:secrets:set` for staging.** The first deploy may ask to
grant the Firebase Rules service access to Firestore (needed by the Storage rules); that is expected.

Rules and indexes are deployed unchanged from `security-rules/` (zero diff from `c419086`).

## 5. Synthetic data and test accounts

```powershell
gcloud auth application-default login
.\scripts\staging\seed-staging.ps1                 # dry run
.\scripts\staging\seed-staging.ps1 -Apply          # writes 15 fictional documents + ai-config (Luna off)
.\scripts\staging\create-testers.ps1 -File C:\private\testers.json            # dry run, file OUTSIDE the repo, 1-5 entries
.\scripts\staging\create-testers.ps1 -File C:\private\testers.json -Apply
```

Every seeded document is marked `synthetic: true` and named "(synthetic)". Production is refused unconditionally. No production data is
read, exported or copied. Testers receive a one-time password-setup link printed in your terminal; pass it on privately. The Super Admin for
staging is created like production: `cd functions; node scripts/super-admin.js --project xploresoweto-staging bootstrap --uid <uid>`.

## 6. Android and EAS

See `docs/staging/ANDROID_AND_EAS.md`.

## 7. Prove the staging app cannot reach production

Automated (all in `cd functions; npm test`): exact-allow-list and swapped-configuration tests (`env_validation`), manifest tests proving
production is unchanged and staging has no secret (`environment`), script guard tests (`admin_scripts`, `staging_ops`), EAS and Gradle
configuration tests (`android_eas`). Manual, once a staging APK exists (these were **not** run by the author):

1. `scripts\staging\check-apk.ps1 -Apk <apk> -Expect staging`: application id ends `.staging`, not debug-signed.
2. Install on a device next to the production app: two icons, "XploreSoweto STAGING" has the red STAGING banner.
3. Network capture (mitmproxy, or Android Studio Network Inspector on a debug build) while signing in, browsing and using Malloya: every
   Firebase/Google host must contain `xploresoweto-staging`, and **no** request may name `xploresoweto` without `-staging`.
4. Sign in on the staging app with a **production** account: it must fail (different Auth user pool). Do this only with a throw-away
   production test account you own; do not use a real customer account.
5. Start a staging build with a wrong variable (for example the production API key): the app must show "This build is not configured
   correctly" and make no network call.

## 8. Rollback and recovery (read the limits)

* **Staging code**: `git checkout <earlier commit>` on a staging branch, then run `deploy-staging.ps1` again. Functions can also be removed
  with `firebase functions:delete <name> --region africa-south1 --project xploresoweto-staging`.
* **Staging data** is disposable: delete the synthetic documents and re-run the seed script, or delete the project
  (`gcloud projects delete xploresoweto-staging`, recoverable for about 30 days).
* **A bad staging build**: uninstall it. The production app is a different application and is unaffected.
* **Production is different. None of the above restores production data.** Redeploying earlier rules or functions changes code, not data.
  If something were written to production by mistake, the only recovery paths are Firestore backups/point-in-time recovery or exports that
  **you have separately enabled on production** (this change does not enable or verify them), and Authentication user restores are not
  covered by any of this. Treat "enable and test production backups" as an open item.

## 9. Limits of this protection (be honest about them)

* One Google account is Owner of both projects. A typed `gcloud`/`firebase` command that names production will run if you type it.
  Consider separate Google identities, or removing your Owner role on staging from the identity used for production work.
* Only **functions** deploys have an automatic hook (`firebase.json` predeploy). Firebase has no such hook for rules or indexes, so a manual
  `firebase deploy --only firestore:rules --project xploresoweto` is **not** guarded. Use `deploy-staging.ps1` for staging, and always pass
  `--project` explicitly for any deploy.
* `.firebaserc` has aliases and **no default** on purpose, but aliases do not protect anything by themselves; the scripts never use them.
* The predeploy guard relies on the CLI exporting `GCLOUD_PROJECT` and expanding `$PROJECT_DIR`; this is documented behaviour but was not
  executed here. Check the first real deploy prints `predeploy-guard: ... allowed`.
* Staging removes the secret binding when `GCLOUD_PROJECT` is exactly `xploresoweto-staging`. If the CLI did not export it, the binding
  would remain and the deploy would fail loudly for a missing secret; it cannot silently deploy a bound secret into staging. The deploy
  script also sets the variable itself.
* The staging bundle contains **both** allow-list entries (including production's public identifiers) by design. The guarantee is that the
  selection is validated against the native application id, not that production strings are absent.
* Client-side checks can be bypassed by someone who rebuilds the app; they protect against mistakes, not against a malicious developer.
* This repository's tests do not run Gradle, EAS, PowerShell or the Firebase emulators; see the implementation report for what was and
  was not executed.
