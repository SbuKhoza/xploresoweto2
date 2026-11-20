# Stage 2A: Anthropic secret setup and deployment guide

Status: **nothing in Stage 2A has been deployed.** Every command below that changes production is for *you* to run, after you approve.
No command here is a bare `firebase deploy`. `firebase.json` also lists Storage rules, and the repository has no `.firebaserc`, so a bare
`firebase deploy` would target whatever project is active on your machine **and** publish Storage rules. Always pass `--project xploresoweto`
and an explicit `--only` list.

## 1. The rule for the key

The Anthropic API key lives only in **Google Secret Manager** (production) or in a **git-ignored local file** (emulator).
It is never in the repository, the app bundle, Firestore, logs, chat messages, or a command-line argument.
A test (`functions/test/ai_security.test.js`) fails if anything shaped like `sk-ant-…` appears in the repo, if client code mentions Anthropic,
if the secret is read anywhere except the provider registry, or if any function other than `aiChat` is bound to it.

## 2. Local development (emulator only)

Use a **separate development key** from a separate Anthropic workspace with a small spend limit (for example US$5).

1. Create `functions/.secret.local` with one line, using your editor so the key never enters your shell history:
   `ANTHROPIC_API_KEY=<your development key>`
   (On Windows: `notepad D:\xploresoweto2\functions\.secret.local`.)
2. Confirm git ignores it: `git check-ignore -v functions/.secret.local` must print a `.gitignore` rule. If it prints nothing, stop.
3. Start the emulators against the demo project, not production: `firebase emulators:start --only functions,firestore,auth --project demo-xploresoweto`.
   The Functions emulator reads `functions/.secret.local` for the `ANTHROPIC_API_KEY` secret parameter.
4. The automated tests (`cd functions && npm test`) never need a key; they use a scripted fake provider.

## 3. Production (you run this; it changes production Secret Manager)

1. Create a **dedicated Anthropic workspace** for XploreSoweto in the Anthropic Console and set its monthly spend limit.
   Recommended: slightly above the in-app budget (for example US$60 against the US$50 in-app breaker) so the Console limit is an independent backstop.
   Create the production key inside that workspace.
2. Store it. The CLI prompts for the value, so the key is not an argument:
   `firebase functions:secrets:set ANTHROPIC_API_KEY --project xploresoweto`
   If it offers to redeploy functions that use the secret, answer **No** (nothing is deployed yet).
3. Confirm it exists without printing it: `firebase functions:secrets:get ANTHROPIC_API_KEY --project xploresoweto`
   (shows metadata and versions; do **not** use `secrets:access`, which prints the value). Check `--help` for your CLI version if the subcommand differs.
4. On deploy, Firebase grants the runtime service account access to the secret **only for functions that declare it**. In code that is `aiChat` alone.
5. Rotation: run step 2 again (creates a new version), redeploy `aiChat`, then remove old versions with `firebase functions:secrets:prune --project xploresoweto` or destroy specific versions. Revoke the old key in the Console.
6. If a key is ever exposed: revoke it in the Anthropic Console first, then rotate as above.

## 4. Independent cost backstops (outside the code)

* Anthropic Console: workspace monthly spend limit (above).
* Google Cloud Billing: create a budget on project `xploresoweto` with alerts at 50%, 80% and 100% (covers Functions, Firestore and Secret Manager costs).
* In-app: spend is estimated from token usage and the price table in `ai-config` defaults. At 50% and 80% it writes an audit-log entry and an error-level log line; at 100% the global circuit breaker trips and the assistant returns "unavailable".
  **These are logged, not emailed.** To be notified, add a Cloud Logging alert on the `ai.budget.threshold` and `ai.circuit_breaker.trip` log entries (not configured).

## 5. Deployment, in this order, each step after your explicit approval

The rules file in this branch also contains the Stage 1 rules, so publishing it publishes both. Decide that deliberately.

1. Index (takes minutes to build; needed by the conversation list):
   `firebase deploy --only firestore:indexes --project xploresoweto`
2. Rules (additive for Stage 2A: three explicit deny-all blocks):
   `firebase deploy --only firestore:rules --project xploresoweto`
3. Functions (only the AI functions; the other Stage 1 functions are not touched by this command):
   `firebase deploy --only functions:aiChat,functions:aiGetUsage,functions:aiListConversations,functions:aiGetConversation,functions:aiDeleteConversation,functions:aiDeleteAllMyAiData,functions:aiAdminGetUsage,functions:aiAdminSetBreaker,functions:aiAdminUpdateConfig --project xploresoweto`
4. Retention backup (TTL). Confirm your database id first (`(default)` assumed):
   `gcloud firestore fields ttls update expireAt --collection-group=ai-conversations --enable-ttl --project=xploresoweto --database="(default)"`
   and the same for `--collection-group=messages` and `--collection-group=ai-usage`. TTL deletion is a backup that can lag by a day or more; user deletion is immediate and does not depend on it.

Never run `firebase deploy --only storage` or an unrestricted `firebase deploy` as part of Stage 2.

## 6. Controls after deployment

* Kill switch: Super Admin calls `aiAdminSetBreaker {action:"trip"}` (immediate, audited) or `aiAdminUpdateConfig {patch:{enabled:false}}`. Re-enable with `{action:"reset"}` or `enabled:true`.
* Change limits, models, prices, retention, budget with `aiAdminUpdateConfig` (validated and bounded; invalid edits are rejected; audited). No redeploy is needed. Editable keys: `enabled, models, effort, maxOutputTokens, limits, loop, budget, retention, languages, planningKeywords, strictEntityMentions, cache, pricing`. The provider cannot be changed from config.
* Usage and spend: `aiAdminGetUsage` (Super Admin only).
* Rollback: `firebase functions:delete aiChat ... --region africa-south1 --project xploresoweto` for each AI function. Stage 1 functions are unaffected.

## 7. Before you enable this for real users

1. Verify the model ids and prices again in the Anthropic documentation (`docs/stage2/VERIFICATION_RECORD.md` records what was checked and when). They can be changed in config without a redeploy.
2. Run a handful of real conversations on a staging project with a low spend limit and read the answers (the prompt has been tested only against a scripted provider).
3. Confirm your privacy notice says that the text the user types is sent to Anthropic.
