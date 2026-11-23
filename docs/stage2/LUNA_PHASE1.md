# Malloya x GPT-6 Luna: Phase 1 (optional wording layer)

**Status: implemented on branch `stage2b/luna-phase1`, tested with a MOCKED provider only. Not deployed. No secret exists. No paid call has been made.**
Luna is **OFF** in code (`luna.enabled: false`) and stays off until you turn it on after the approvals below.

## What it is (and is not)
Malloya's deterministic engine stays the only source of facts, retrieval, safety, cards, follow-ups, itineraries, limits, idempotency and persistence.
Luna may only **re-word a few server-designated, fact-free phrases** (the greeting opener and question, and the "thanks" line). Everything else, including every
block that carries facts and the capability sentence inside the greeting, is pinned byte-for-byte. Any failure, limit, refusal or doubt returns Malloya's own wording.
There is no "AI reworded" label on messages (decided). The notice and the user's choice are the disclosure.

What Luna receives: fixed instructions + fixed template phrases ("Hi!", "What would you like to do?", "You're welcome! Ask me anything else about Soweto.") + a language code.
Never the user's message, uid, email, phone, location, conversation/request ids, tokens, cards or database records.

## Request path (`aiChat`)
1. Malloya answers (unchanged). 2. `luna.tryRewrite()` runs cheapest-check-first and can only turn Luna OFF:
feature on -> app sent `aiNoticeVersion` -> block is an exact known template (English) -> payload is calibrated -> key present -> **server-side consent** recorded for the current notice ->
user allowance left -> per-instance concurrency -> circuit breaker (one global probe) -> **durable "called" commit + maximum budget reservation** -> provider call ->
strict validation -> usage committed **inside the same transaction** as the conversation turn.
3. `tryRewrite` never throws and never refuses a valid request.

## The paid-call crash rule
`usage.begin()` commits `ai-usage/luna_r_{hash(uid,requestId)}` as `called` (budget reserved at calibrated input + 500 output, attempt counted) in one transaction **before** any network request.
Any existing record for a requestId means **never call the provider again**, whatever its state. A crash after that commit loses at most one rewrite and leaves one conservative reservation (counted for that day only).
(`reserved` and `called` are committed together, so a reserved-but-uncalled record that could cause a second call cannot exist.)
Settlement: success -> usage trued up to the provider's reported tokens (input, output, cached, reasoning) inside `persistTurn`; provider rejected before doing work (429, 401/403, 400) -> reservation released;
possibly processed (timeout, 5xx, dropped connection) -> reservation stays charged; unusable/refused output -> actual reported usage charged, no success counted.

## Limits (status as agreed)
| Setting | Value | Status |
|---|---|---|
| Successful Luna answers per user per day | 10 | **Approved** |
| Input tokens per request | 3,000 | **Agreed design limit**, enforced BEFORE the call (calibrated payload set) |
| Provider attempts per user per day | 25 | Recommended starting ceiling |
| Global tokens per day | 1,500,000 (8 shards) | Recommended starting ceiling |
| Concurrent calls | 2 per instance x `maxInstances` (10 for `aiChat`, verified `10 / 80 concurrency`) = 20 | Recommended starting ceiling. A per-instance semaphore; a global figure only while `maxInstances` stays 10 |
| Calls during recovery | 2, global (shared counter in the breaker document) | Recommended starting ceiling |
| Output tokens | 500 | Proposed |
| Reasoning effort | `none`, falls back to `low`, decided by calibration | Proposed |
| Breaker: 5 failures / 60 s opens; cooldown 60 s (x2 per failed probe, max 600 s); recovery 60 s; probe lease 30 s | | Proposed |
All are bounded by hard ceilings in code (`luna/constants.js CEILINGS`) that no stored setting can exceed. Luna's allowance is separate from Malloya's 50/day and 5/min.

## Token-budget control (why 3,000 is protected before the call)
The set of possible payloads is **closed** (templates x languages, today: `greeting:en`, `thanks:en`). `calibration.json` holds each payload's hash and the API-reported input-token count.
Luna is skipped unless the payload's hash matches, its measured count is within the limit, the byte ceiling holds, and the manifest is `calibrated`. A test fails when any template or
the instructions change without re-running `npm run luna:calibrate` (or `npm run luna:hashes`, which keeps Luna off). The byte ceiling is a secondary guard, not proof of a token limit.
The committed manifest is **uncalibrated**, so even with everything enabled Luna cannot run until you calibrate.

## Provider errors
No automatic retries (every call is paid). 429 is classified by the structured `error.type`/`error.code`: `insufficient_quota`, `credit_balance_exhausted`, `organization_spend_limit_exceeded`,
`project_spend_limit_exceeded`, `organization_usage_limit_exceeded` => **billing: breaker BLOCKED**, no timed retries; anything else 429 => rate limit: breaker opens, honours `Retry-After`.
401/403 => BLOCKED too. A blocked breaker clears only when an operator raises `luna.resetEpoch` (Super Admin, `aiAdminUpdateConfig`). If the breaker cannot be read, Luna is treated as off.

## Contention
Global budget = 8 shard documents; a request normally touches one. The breaker document is only READ on the hot path (written on failures and state changes). No global in-flight map exists.
Per-user documents are written once per Luna call. **Real capacity is unmeasured**: before activation run a short load test on a non-production project (none is known yet).
If any Luna transaction fails or times out, the request is answered deterministically.

## Consent (`ai-consent/{uid}`, written only by `aiSetLunaConsent`)
| Action | Effect |
|---|---|
| accept (current notice version) | Luna may be used for this user. |
| withdraw | Luna stops with the very next message. **Deletes nothing.** |
| `aiDeleteConversation` | Deletes the selected conversation only. Consent unchanged. |
| `aiDeleteAllMyAiData` (app label **"Delete all my conversations"**) | Deletes all the user's conversations. Usage counters AND the consent record are kept; the app says so. |
| consent record retention | Kept while the account is active (notice version, accepted/withdrawn timestamps, no content). **Account deletion: no hook exists in this backend yet.** Whether to keep it for a period is a privacy/POPIA decision; no indefinite default is implemented. |
`aiNoticeVersion` in `aiChat` is only a capability signal (old apps never send it and stay deterministic); it is never treated as consent.

## Rollout: separate approvals, in this ORDER
1. **Calibration** (about 3 paid calls). Locally: `$env:OPENAI_API_KEY = Read-Host "OpenAI key"` then `cd functions; npm run luna:calibrate`; review and commit `calibration.json`. Never paste the key into chat, files or Git.
2. **Merge** `stage2b/luna-phase1` after review (this branch, no deployment).
3. **Secret**: `firebase functions:secrets:set OPENAI_API_KEY --project xploresoweto`. **This must come BEFORE the deploy**: `aiChat` declares the secret, so deploying without it fails.
4. **Backend deploy**, only the affected functions, with `luna.enabled` still false:
   `firebase deploy --only functions:aiChat,functions:aiSetLunaConsent,functions:aiGetUsage,functions:aiAdminGetUsage,functions:aiAdminUpdateConfig --project xploresoweto`
   (`aiGetConversation`, `aiListConversations`, `aiDeleteConversation`, `aiDeleteAllMyAiData` are unchanged and are not redeployed.) Afterwards confirm `aiChat` shows `10 80`:
   `gcloud functions describe aiChat --gen2 --region africa-south1 --project xploresoweto --format="value(serviceConfig.maxInstanceCount,serviceConfig.maxInstanceRequestConcurrency)"`
5. **App update** (notice card + switch + `aiNoticeVersion`). Old app versions keep working, deterministic only.
6. **Activation**: Super Admin sets `luna.enabled: true`. **Not before** the privacy notice wording, the privacy policy and the POPIA review are settled.
Kill switch at any time: `aiAdminUpdateConfig {patch:{luna:{enabled:false}}}` (takes effect within the 60 s config cache).
No rules or indexes change. `ai-consent` and the new `ai-usage` documents are closed to clients by the existing default-deny.

## Things this branch could not verify (stated plainly)
- Whether `gpt-6-luna` accepts `reasoning.effort: "none"` and returns the usage fields as assumed: calibration checks this (falls back to `low`).
- Firestore behaviour under real load (see Contention).
- The notice wording is yours to approve. It now says exactly what Phase 1 sends (only short Malloya-written template text and a language code), says the user's messages, account details and location are not sent, and makes no security, retention or deletion promise (no "securely", no zero-data-retention claim). Tests tie that statement to the real payload. It still says conversations are handled "in accordance with XploreSoweto's privacy policy", but no privacy-policy screen exists in the app yet. If a later phase sends anything more, the wording and `NOTICE_VERSION` must change together.
- Retention/deletion of the consent record on account deletion (policy decision, above).
- `deleteConversation` / `deleteAll` are not atomic (existing behaviour): a chat racing a delete can leave orphan messages that the 90-day TTL removes.
