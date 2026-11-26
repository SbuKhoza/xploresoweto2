# Malloya reviewed learning: design, privacy, and callable contracts

Status: implemented on `feature/malloya-learning`, **not deployed**. Collection is **off** and cannot be switched on until a Super Admin records `privacyAcknowledged`. No external AI provider is involved; Luna is untouched and stays blocked in staging.

## What it does
1. Malloya notices what it could not answer (`unsupported_intent`, `no_match`, `missing_knowledge`) and what a user marks unhelpful (`feedback_unhelpful`, `feedback_correction`).
2. Each miss is reduced, **in memory**, to a *signature* (see Privacy) and counted. The original text is discarded.
3. A Super Admin reviews candidates and approves them as **versioned knowledge**: `phrase_intent` (signature -> a supported intent), `answer` (admin-written text, shown as a `knowledge` block, never `verified`) or `place_alias` (alias -> a place Malloya already knows; created directly, never from user text).
4. The deterministic engine **uses** active knowledge: a learned phrase fills a gap only when no strong built-in intent matched and never for emergencies or non-learnable intents; an answer is consulted before the "I did not understand" fallback; an alias is substituted before matching. Disable or revoke stops use (this instance immediately, others within the 60 s cache).
Nothing a user says is ever turned into a verified fact, and no record can carry code or instructions: payloads are typed, validated, re-validated on load, and only enumerated intents are reachable.

## Privacy and safety (in force before collection can start)
* **Gate**: `learning.collect` is false by default; validation rejects `collect: true` unless `learning.privacyAcknowledged: true` (a stored config violating this is ignored). Enable only after the privacy notice and review are done.
* **Screen (`learning/screen.js`, fail closed)**: refuses text that is long, has control characters, any sensitive topic (health, identity, finance, credentials, crisis/emergency, politics, religion, sexuality, crime, self-identification such as "my name / my address"), or any email, link, handle or number run. Otherwise every word not in the fixed vocabulary (`learning/vocab.js`) becomes `<x>`, small numbers `<n>`, known landmarks `<place>`. At least two meaningful allow-listed words are required, at most 12 tokens and 2 unknown words. Names, streets and free sentences cannot survive.
* **Candidates hold**: kind, signature, intent hint, suggested-intent counts, count, first/last day, status, expiry. **Never** the text, a uid, a conversation or message id.
* **Bounds**: per-user per-day cap (default 10), global new-candidates per day (default 200), same user + same signature counted once per day, retention default 60 days (`expireAt`).
* **User controls**: `aiSetLearningOptOut`; opted-out users contribute nothing. Feedback is structured (rating + optional intent from a fixed list), no free text; the user's own message is read server-side and screened.
* **Deleting history vs erasing data (separate operations)**: `aiDeleteConversation` / `aiDeleteAllMyAiData` delete conversations ONLY; they keep the learning opt-out, the Luna notice choice, the learning throttle record and the usage counters. `aiEraseMyAiData {confirm:"ERASE-MY-AI-DATA", releaseOptOut?}` additionally removes the Luna notice record, learning throttle/de-duplication records and any registered personal-memory store (`ai/erasure.js registerEraser`; none exists yet), and keeps the opt-out unless `releaseOptOut:true` (so erasing never silently re-enrols someone). `eraseAiAccountData(uid,{accountClosed:true})` is the library hook for a future account-closure flow and also removes the opt-out. **Never erased, by design (financial safeguards):** `ai-usage` per-user counters and Luna's `luna_u_*`, `luna_g_*`, `luna_r_*` records. No account-deletion backend exists yet, so nothing calls the hook; it must be called when account deletion is added.
* Candidates are anonymous aggregates with no identifier, so a single contribution **cannot be individually withdrawn**; this is stated in the in-app notice.
* **Separation**: nothing here is personal memory. Per-user data is limited to the throttle record and opt-out flag.
* **Access**: all four collections are denied to every client by Firestore rules (additive, deny-all) and are in `PRIVATE_COLLECTIONS`, so the assistant can never read them as content.

## Counting rules (no inflation)
Every record attempt carries a required `dedupeKey` (chat: the requestId; feedback: the messageId). A non-day-scoped event record (`ai-learning-events`, 7-day expiry, holds only a hash id and the uid) makes the attempt idempotent across concurrent calls and across midnight. The same user asking the same thing again on the same day counts once. Per-user and global per-day caps apply. All of this, plus the settings, opt-out and candidate, is read and written in ONE transaction, so a concurrent opt-out or a switched-off collection setting is honoured immediately (not after the 60 s config cache).

## Privacy screen (fail closed)
Refuses: control/hidden/bidi/zero-width characters; any non-ASCII digit; non-Latin scripts and emoji; text over 200 characters or with 25+ character tokens (encoded blobs); 7+ digits anywhere or a 5+ digit run once separators are removed; digits spelled out in English, Afrikaans, isiZulu, Sesotho or Setswana (6+); leetspeak digit runs; emails and "name at host dot com" forms; links and handles; instruction-like or markup text; first-person disclosures and sensitive topics in English, isiZulu, isiXhosa, Sesotho, Setswana and Afrikaans; and mostly-unknown text. Accents and full-width forms are folded first. Any exception inside the screen is a refusal. The lists are deliberately over-broad: a false refusal costs one candidate.

## Retention and TTL requirements
| Data | Held | Expires |
|---|---|---|
| New candidate | signature, counts | `candidateRetentionDays` (default 60, 1-365) after the last occurrence |
| Reviewed candidate (approved/rejected) | same + status | 365 days after review |
| Expired candidate | - | cannot be listed, approved or rejected (`candidate-expired`); the next occurrence starts a fresh candidate at count 1 |
| `ai-learning-seen` (throttle) | uid, counts, hashes | 3 days |
| `ai-learning-events` (de-duplication) | uid, hash id | 7 days |
| Approved knowledge | admin-authored | until revoked; revoked items are kept (with versions) for audit |
| Opt-out flag | uid | until the user clears it or the account is closed |
Firestore TTL deletes physically (typically within 24 h of `expireAt`); the application treats expiry as final immediately. TTL policies are NOT created by this branch. When you approve it, run for each of `ai-learning-candidates`, `ai-learning-seen`, `ai-learning-events` (and the existing `ai-conversations`): `gcloud firestore fields ttls update expireAt --collection-group=<name> --enable-ttl --project=<project>`. Without TTL, `aiAdminPurgeLearning {scope:"expired"}` removes expired candidates, but seen/event records would persist, so enable TTL before turning collection on.

## Collections (server-only)
`ai-learning-candidates/{id}`, `ai-knowledge/{id}` (+ `versions/{n}`), `ai-learning-seen/{uid_day|g_day}`, `ai-learning-events/{hash}`, `ai-learning-optout/{uid}`. No composite index is needed (admin queries filter on one field and sort in memory over at most 500 documents).

TTL: see "Retention and TTL requirements" above.

## Callable contracts (Firebase callable; errors are `HttpsError`)
All require a signed-in user with a verified email. Admin callables additionally require an **active Super Admin** (custom claim + verified email + active `super-admin/{uid}` record), checked on the server; otherwise `permission-denied`. Unknown keys -> `invalid-argument`.

**User**
* `aiSubmitFeedback {conversationId, messageId, rating: "helpful"|"unhelpful", correctionIntent?: <learnable intent>}` -> `{recorded: bool, reason?: "off"|"not-needed"|"opted-out"|"not-safe-to-keep"|"duplicate"|"user-cap"|"daily-cap"}`. `messageId` is the assistant message id from `aiGetConversation`.
* `aiSetLearningOptOut {optOut: bool}` -> `{optOut}`.
* `aiEraseMyAiData {confirm:"ERASE-MY-AI-DATA", releaseOptOut?: bool}` -> `{erased, conversations, retained[]}`.
* `aiGetUsage` additionally returns `learning:{available, noticeVersion, optedOut}`; `available` is true only when `collect` and `privacyAcknowledged` are both on.
* `aiGetUsage` and the chat response are unchanged.

**Super Admin**
* `aiAdminListLearningCandidates {status?: "new"|"approved"|"rejected" (default new), kind?, limit?<=200}` -> `{candidates:[{id, kind, signature, hintIntent, suggestedIntents, count, firstDay, lastDay, status, knowledgeId?, reason?}]}` sorted by count.
* `aiAdminReviewCandidate {candidateId, decision: "approve"|"reject", type?: "phrase_intent"|"answer", payload?, reason?}`; approve needs `type`+`payload` (`phrase_intent`: `{sigs:[1..5 signatures], intent}`; `answer`: `{sigs, text 10..500 chars, no links/HTML/contact details}`); reject needs `reason`. -> `{status, knowledgeId?}`. Errors: `already-reviewed`, `knowledge-exists`, `invalid-signature`, `intent-not-learnable`, `invalid-text`.
* `aiAdminSaveKnowledge {type, payload}` creates directly (`place_alias`: `{alias, canonical}`; `canonical` must be a built-in landmark or stored township, else `unknown-canonical-place`). -> `{knowledgeId, version: 1}`.
* `aiAdminUpdateKnowledge {knowledgeId, action: "edit"|"disable"|"enable"|"revoke", payload?, reason?}`; reason (enum below) required for disable/revoke. Each change adds a version. `revoke` is final (`revoked-is-final`; create a new item). -> `{version, status}`.
* `aiAdminListKnowledge {status?, type?, limit?}` -> `{knowledge:[{id,type,status,version,signatures?,intent?,text?,alias?,canonical?,updatedAt}]}`.
* `aiAdminKnowledgeHistory {knowledgeId}` -> `{versions:[{version, action, reason, snapshot, at}]}`.
* `aiAdminLearningStats {}` -> `{learning:<config>, candidates:{total, byStatus, byKind, occurrences, top[10], truncated}, knowledge:{total, byStatus, byType, truncated}, newCandidatesToday}` (bounded to 500 documents per collection).
* `aiAdminPurgeLearning {scope: "expired"|"rejected"|"new"|"all", confirm?: "DELETE-ALL-CANDIDATES" (required for all)}` -> `{deleted, more}` (400 per call; call again while `more`).
* **Settings**: existing `aiAdminUpdateConfig {patch:{learning:{collect, privacyAcknowledged, use, maxNewPerDay, maxPerUserPerDay, candidateRetentionDays}}}`; `aiAdminGetUsage` returns them. `use:false` is the kill switch for approved knowledge. `aiAdminGetUsage` / `aiAdminUpdateConfig` behave as before for every other key.

Reason enum: `not_useful, unsafe, duplicate, out_of_scope, incorrect, outdated, other`. Every review/knowledge/purge action writes an `audit-log` entry (ids, type, version, enum reason; never text) in the same transaction. XploreCMS is a separate app and was not touched; the contracts above are everything it needs.

## Not included / honest limits
* The app now has feedback, opt-out and notice controls (see the controls report). Collection must still stay off until the owner has approved the in-app notice wording and the privacy policy mentions this feature.
* Knowledge uniqueness (no two live items claim the same signature or alias) is checked before the write, not inside the transaction: two simultaneous creates of the same signature could both succeed. The engine breaks any tie deterministically (lowest id wins).
* Cross-instance cache: other instances see a disable/revoke within 60 s.
* Anonymous candidates cannot be withdrawn individually (see Erasure).
* The Firestore rules change is covered by the added rules-test paths, but the emulator suite cannot run in this environment; run `npm test` in `security-rules` on your machine.
* Candidates are counted per distinct user per day, so counts are an indication of demand, not a vote.
