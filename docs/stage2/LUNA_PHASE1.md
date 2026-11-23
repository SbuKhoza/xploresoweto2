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
Settlement: success -> usage trued up to the provider's reported tokens (input, output, cached, reasoning) inside `persistTurn`; provider rejected before doing work (429, 401/403, 400/404/405/413/415/422) -> reservation released;
possibly processed (timeout, 5xx, dropped connection) -> reservation stays charged; unusable/refused output -> actual reported usage charged, no success counted.

## Limits (all agreed; round 2 made them hard)
| Setting | Value | Enforced by |
|---|---|---|
| Successful Luna answers per user per day | **10** | ceiling + default + validation + clamp at use |
| Provider attempts per user per day | **25** | same |
| Input tokens per request | **3,000** | same, and BEFORE the call (calibrated payload set); 3 actual reports above it hard-block Luna |
| Output tokens per request | **500** | same |
| Global tokens per day | **1,500,000** (8 shards) | same |
| Concurrent provider calls per instance | **2** (x `maxInstances` 10 for `aiChat` = 20; verified `10 / 80 concurrency`) | same. Global only while `maxInstances` stays 10 |
| Concurrent calls during recovery | **2**, global (shared map in the breaker document, keyed by a hash of uid + requestId) | same |
| Provider timeout | **8 s** | same |
| Reasoning effort | `none`, falls back to `low`, decided by calibration | calibration |
**Super Admin cannot exceed these.** They are enforced twice: `validateConfig` rejects anything above `CEILINGS` (`luna/constants.js`), and `effectiveCfg()` clamps every limit again at the start of each request, so a document written around the validator is still clamped.
Lower values are allowed and respected. `luna.breaker.leaseSeconds` must be at least 10 and always outlives the provider timeout by 2 s (validated, and lengthened at use), so a probe lease or recovery slot cannot expire while its call is still running.
Luna's allowance is separate from Malloya's 50/day and 5/min.

## Circuit breaker (`ai-usage/luna-breaker`, shared by all instances)
| Trigger | Result | Cleared by |
|---|---|---|
| 5 counted failures in 60 s (5xx, timeout, network, unusable or incomplete response, 408/409/425, unexpected 4xx) | open, cooldown 60 s (doubles per failed probe, max 900 s) | cooldown, then ONE global probe, then recovery (2 concurrent calls for 60 s), then closed |
| 429 rate limit | open, honours `Retry-After` (max 900 s) | same |
| 429 billing/quota code, 401/403 | **blocked** | operator raises `luna.resetEpoch` |
| **400 / 404 / 405 / 413 / 415 / 422** (our request, model name or endpoint is wrong) | **blocked** | operator raises `luna.resetEpoch` |
| **8 rejected outputs among the last 10 validated responses** (our validator refused them) | open for **900 s** | cooldown, then probe/recovery as above |
| **3 actual input-token reports above the input limit** (calibration no longer matches reality) | **blocked** (`blockedKind: input_overrun`) | operator raises `luna.resetEpoch`, after re-calibrating |
Notes: a rejected output is the provider behaving, so it never counts as a provider failure; it only feeds the 8-of-10 rule. The rejection window and the overrun counter live in the breaker document and survive open/probe/recovery cycles;
a reset (`resetEpoch`) clears them. A clean history writes nothing on the hot path. Breaker owners (probe lease, recovery slots) are `sha256(["owner", uid, requestId])`, never the raw requestId, so two users sending the same requestId occupy two slots.

## Consent race
The consent record is read INSIDE the same transaction that stores the answer (`persistTurn` -> `luna.read(tx)`). If consent was withdrawn (or the notice version no longer matches) while the provider call was running,
Malloya's original deterministic wording is stored and returned, the request record is settled as `consent-withdrawn`, the real token cost is still charged to the user's and global counters, and **no success is counted**.
The chat response always returns what was actually stored. Tests: gated mocked provider, withdraw during the call, release, verify the stored text and counters.

## Request-record retention (`luna_r_*`)
**Rule:** the same requestId must never cause a second provider call. That is only true while the `luna_r_*` record exists, so its lifetime is the lifetime of the guarantee.
**Is 3 days enough? No.** The record is the only guard once the stored reply is gone: stored replies live `retention.days` (default 90, maximum 365), and a user can delete a conversation or all conversations at any time, which removes the stored reply immediately.
After that, a client that replays an old requestId reaches Luna again and only the record stops a second paid call. Three days left a gap of up to a year.
**Change in this round (a proposal that STRENGTHENS the guarantee; nothing was weakened):** `REQUEST_RECORD_TTL_DAYS = 400` = the 365-day maximum reply retention plus 35 days of margin.
**Honest limits:** (1) 400 days is bounded, not absolute: a client replaying a requestId more than 400 days later could trigger one more paid call; that call is still capped by the per-user daily limits (10 successes / 25 attempts) and the global budget.
(2) No Firestore TTL policy is configured for `expireAt` on `ai-usage` yet. Until one is, records do not expire at all (stricter than 400 days). Deciding to create that policy is a separate approval (it is a Firebase change and is not made here).
(3) Storage cost is one small document (about 200 bytes) per paid call, at most 25 per user per day.
**Alternative if you want the guarantee to be absolute:** store no `expireAt` on `luna_r_*` records (never expire). The cost is unbounded growth of those small documents; it can be added by removing one line. Say so if you prefer it.
The per-user and per-shard counters keep their 3-day expiry (they are day-scoped counters, not guards).

## Token-budget control (why 3,000 is protected before the call)
The set of possible payloads is **closed** (templates x languages, today: `greeting:en`, `thanks:en`). `calibration.json` holds each payload's hash and the API-reported input-token count.
Luna is skipped unless the payload's hash matches, its measured count is within the limit, the byte ceiling holds, and the manifest is `calibrated`. A test fails when any template or
the instructions change without re-running `npm run luna:calibrate` (or `npm run luna:hashes`, which keeps Luna off). The byte ceiling is a secondary guard, not proof of a token limit.
The committed manifest is **uncalibrated**, so even with everything enabled Luna cannot run until you calibrate.

## Provider errors
No automatic retries (every call is paid). 429 is classified by the structured `error.type`/`error.code`: `insufficient_quota`, `credit_balance_exhausted`, `organization_spend_limit_exceeded`,
`project_spend_limit_exceeded`, `organization_usage_limit_exceeded` => billing; anything else 429 => rate limit. See the breaker table above for what each does. If the breaker cannot be read, Luna is treated as off.

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
- The notice wording is yours to approve. It now says exactly what Phase 1 sends (only short Malloya-written template text and a language code), says the user's messages, account details and location are not sent, and makes no security, retention or deletion promise (no "securely", no zero-data-retention claim). Tests tie that statement to the real payload. It no longer refers to a privacy policy (round 2); a reference can be added back once an accessible policy exists. The notice version stays 1 because nobody can have consented yet (Luna has never been active). If a later phase sends anything more, the wording and `NOTICE_VERSION` must change together.
- Retention/deletion of the consent record on account deletion (policy decision, above).
- `deleteConversation` / `deleteAll` are not atomic (existing behaviour): a chat racing a delete can leave orphan messages that the 90-day TTL removes.
