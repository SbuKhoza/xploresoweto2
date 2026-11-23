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
| **3 consecutive counted failures** (5xx, timeout, network, unusable or incomplete response, 408/409/425, unexpected 4xx), OR **5 counted failures within 60 s** | open, cooldown step 0 = 60 s | cooldown, then ONE global probe, then recovery (2 concurrent calls for 60 s), then closed |
| any provider response (even one our validator rejects) | resets the consecutive-failure count | automatic |
| failed probe, or a failed call during recovery | open, next step of the ladder **60, 120, 300, 600, 900 s** (stays at 900 s) | as above; the ladder restarts at 60 s once the breaker has closed |
| 429 rate limit | open at the current step, or `Retry-After` if longer (max 900 s) | same |
| 429 billing/quota code, 401/403 | **blocked** | operator raises `luna.resetEpoch` |
| **400 / 404 / 405 / 413 / 415 / 422** (our request, model name or endpoint is wrong) | **blocked** | operator raises `luna.resetEpoch` |
| **8 rejected outputs among the last 10 validated responses** | open for **900 s** | cooldown, then probe/recovery as above |
| **3 actual input-token reports above the input limit** | **blocked** (`blockedKind: input_overrun`) | operator raises `luna.resetEpoch`, after re-calibrating |
The cooldown ladder is fixed in code (`COOLDOWN_STEPS`); there is no `cooldownSeconds` setting any more. The rejection window, the consecutive count and the overrun counter live in the breaker document and survive state changes; a reset (`resetEpoch`) clears them.
A clean history writes nothing on the hot path. Breaker owners (probe lease, recovery slots) are `sha256(["owner", uid, requestId])`, never the raw requestId.

### Fail-closed on a lost provider outcome: the unresolved-call record (round 4; replaces the round-3 hold documents)
**Mechanism.** The permanent `luna_r_*` record that `begin()` commits BEFORE the provider request now also carries `unresolved: true`, its server-committed `calledAt`, and the reset `epoch`.
| What happened to the outcome | What the record looks like | Who resolves it |
|---|---|---|
| Normal: the breaker was updated, then the settle transaction ran | `unresolved` removed in the same settle transaction | nobody needs to |
| The breaker update was lost (retried once, still failed) but the settle worked | `state: settled`, `unresolved: true`, `pendingEvent: {exact event}` | the next `admit()` on ANY instance replays it |
| Every write was lost, or the instance died after `begin()` | `state: called`, `unresolved: true` | after the grace period, the next `admit()` on any instance replays a conservative `unreported` event |
**`admit()`** issues the breaker read and the `unresolved == true` query IN PARALLEL and awaits BOTH (either failing denies). Rows `called` and younger than the grace period are genuinely in flight and ignored.
Everything else is reconciled: for chunks of 20 records, ONE transaction re-reads each record, applies its event to the breaker through the same reducer `report()` uses, and rewrites the record as resolved (`resolvedBy: reconcile`, `unresolved` removed; a stale `called` record becomes `state: unreported`). The record is **never deleted** and its token reservation is **never released**.
Because the application and the resolution are one transaction, a replay is atomic, and concurrent reconcilers are idempotent: the second one re-reads, sees the record resolved, and skips it (test: two events, six concurrent reconcilers, applied exactly twice, not four times).
An event recorded before an operator reset (older `epoch`) is resolved but not applied.
**Bounded and fail-closed.** Pages of 50, at most 6 reconcile rounds (300 records). `admit()` DENIES (reason `unresolved-calls:*`) when: any chunk transaction fails; the query or the breaker read fails; the backlog is not proven empty after 6 rounds; or a full page contains nothing actionable (a full page cannot prove nothing is behind it). Tested with backlogs of 50, 51, 101 and 120 (plus 301 which denies and finishes on the next attempt), mixed in-flight and stale records, and injected failures.
Limitation: in-flight records occupy page slots. At most 2 x 10 = 20 can exist under the concurrency caps, so at least 30 slots per page always make progress; more than that fails closed (tested).
**Stale outcome = conservative, not a hard block.** The `unreported` event opens the breaker at the current ladder step (60 s first). If the real cause was auth or billing, the next probe finds it and hard-blocks. A late settle from the original instance finds the record no longer `called`, does nothing, and cannot double count.
**Grace period: 90 s, not 30 s.** The brief asked for the grace to exceed the complete provider-call and settlement window. That window is the whole `aiChat` invocation: provider call (8 s), breaker report (two attempts), the rest of the chat handler and `persistTurn`. `aiChat` sets no `timeoutSeconds`, so it runs on the 2nd-gen default of **60 s**, and a 30 s grace could sweep a call that is still legitimately settling. Grace = 60 s function timeout + 30 s for clock skew and scheduling. It is measured from `calledAt`, a server timestamp committed by `begin()`; the comparison uses the instance clock, whose skew is assumed to be well under 30 s. `FUNCTION_TIMEOUT_SECONDS` is pinned to `functions/index.js` by a test: raising `timeoutSeconds` there without raising the grace fails the build.
**What is and is not guaranteed.** (1) An instance that cannot write cannot start a new paid call (`begin()` is a write transaction); only the at most 2 calls it already had in flight can have lost outcomes. (2) Any lost outcome is on a durable record, so any healthy instance recovers it. (3) **Exposure window:** for up to 90 s after a lost outcome, other healthy instances can still admit calls, because the record cannot yet be told apart from a call still in flight. Spend in that window is capped by the per-user limits (10 / 25), the 1.5M global token budget and 2 concurrent calls per instance. (4) Strict "never admit while any outcome is unreported" is not achievable without a global lock that would serialise all calls. (5) A crash after the breaker update but before the settle transaction makes the next reconcile open the breaker once more (conservative, 60 s). (6) The in-memory 60 s local hold (set when `report()` fails) is an extra layer, never the only one.
**Index and rules.** The query is one equality filter (`unresolved == true`), no ordering, no range, `limit(50)`: it uses the automatic single-field index. `security-rules/firestore.indexes.json` has `"fieldOverrides": []`, so nothing exempts `unresolved`. **No index and no rules change is needed** (a test pins this). The query runs with the Admin SDK on the server; clients cannot reach `ai-usage`.
**Read cost (ESTIMATES from the code and Firestore's billing rules; NOTHING here was measured, because this session has no Firestore access).** Per eligible Luna request (one that passed every cheap gate):
- the breaker read: 1 document read (already there before round 4);
- the unresolved query: billed per document returned, minimum 1. Documents returned = records currently in flight, about (arrival rate x call duration), at most 20 under the caps. At one eligible request per second and about 2 s per call that is about 2 reads; the empty-case minimum is 1.
- So about 2 to 3 extra reads per eligible request in normal use, 21 at the absolute worst.
- Upper bound for planning: 1,000 users x 25 attempts/day = 25,000 requests/day x about 3 = about 75,000 extra reads/day. At a rate of roughly US$0.03 to 0.06 per 100,000 reads (the africa-south1 price must be checked against the current price list) that is about US$0.02 to 0.05 per day, about US$1 to 1.50 per month.
- Reconcile writes happen only after a lost outcome: rare.
**Latency (ESTIMATE, unmeasured).** The query runs in parallel with the breaker read, so the added time is about max(query, read) minus read, typically 0 to 15 ms when Firestore is in the same region as the function, up to about 150 ms or more if it is not. Measure it from the first Luna requests after activation (the structured log should be checked for `admit` timing before widening the rollout); do not rely on the figures above.
Optional later saving, NOT implemented: cache an empty result for about 2 s per instance. It would cut reads at high volume at the price of up to 2 s more exposure.

## Consent race
The consent record is read INSIDE the same transaction that stores the answer (`persistTurn` -> `luna.read(tx)`). If consent was withdrawn (or the notice version no longer matches) while the provider call was running,
Malloya's original deterministic wording is stored and returned, the request record is settled as `consent-withdrawn`, the real token cost is still charged to the user's and global counters, and **no success is counted**.
The chat response always returns what was actually stored. Tests: gated mocked provider, withdraw during the call, release, verify the stored text and counters.

## Request-record retention (`luna_r_*`): NO expiry (round 3)
**Rule:** the same uid + requestId must never cause a second provider call, after any number of days. `luna_r_*` records therefore have **no `expireAt`** and nothing deletes them. The day-scoped counters (`luna_u_*`, `luna_g_*`) keep their 3-day expiry, separately. No Firestore TTL policy is created by this branch; if one is ever created for `expireAt` it will not touch `luna_r_*` because they carry no such field.
(Round 2 had proposed 400 days; ChatGPT's review asked for the absolute rule, which this implements. Test: "RECORDS: ... never reaches the provider again, even years later".)
**Storage trade-off:** one small document (about 200 bytes) per paid call, at most 25 per user per day, forever. Worst case per user is about 5 KB per day; for example 1,000 active Luna users at the daily cap would add roughly 1.8 GB over a year. Realistic use is far lower (10 successful answers per user per day maximum, and only template phrases are eligible). Firestore storage is billed per GB-month; there is no automatic clean-up. If growth ever matters it can be revisited as an explicit decision (for example an archive job), not silently.
**Privacy trade-off:** the document id is a truncated SHA-256 of uid + requestId, and the body holds the uid, day, state, token counts and timestamps. Round 4 adds only `unresolved`, `epoch`, `resolvedBy`/`resolvedAt` and, transiently, a `pendingEvent` (hashed owner key, outcome kind and flags; no user or message data). It contains **no conversation text, no message, no template text and no reply**. It is a pseudonymous usage record kept to prevent duplicate paid calls and to account for spend. Because it never expires it also **outlives conversation deletion and, today, account deletion** (the backend has no account-deletion hook). Whether that retention is acceptable, and whether to add an erasure path for a deleted account (the id can be recomputed from uid + requestId only when the requestId is known, so erasure by uid would need a `uid` query on `luna_r_*`), is a privacy/POPIA decision for the owner and must be settled before activation. The AI notice makes no retention promise either way and was not changed.

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
