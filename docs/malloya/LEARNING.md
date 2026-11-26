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
* **Erasure**: `aiDeleteAllMyAiData` also deletes the user's throttle records and opt-out. Candidates are anonymous aggregates with no identifier, so a single contribution **cannot be individually withdrawn**; this must appear in the privacy notice.
* **Separation**: nothing here is personal memory. Per-user data is limited to the throttle record and opt-out flag.
* **Access**: all four collections are denied to every client by Firestore rules (additive, deny-all) and are in `PRIVATE_COLLECTIONS`, so the assistant can never read them as content.

## Collections (server-only)
`ai-learning-candidates/{id}`, `ai-knowledge/{id}` (+ `versions/{n}`), `ai-learning-seen/{uid_day|g_day}`, `ai-learning-optout/{uid}`. No composite index is needed (admin queries filter on one field and sort in memory over at most 500 documents).

**TTL (not applied by this branch; creates a cloud setting, run it yourself when you approve):**
`gcloud firestore fields ttls update expireAt --collection-group=ai-learning-candidates --enable-ttl --project=xploresoweto-staging` (repeat for `ai-learning-seen`). Until then `aiAdminPurgeLearning {scope:"expired"}` removes expired items.

## Callable contracts (Firebase callable; errors are `HttpsError`)
All require a signed-in user with a verified email. Admin callables additionally require an **active Super Admin** (custom claim + verified email + active `super-admin/{uid}` record), checked on the server; otherwise `permission-denied`. Unknown keys -> `invalid-argument`.

**User**
* `aiSubmitFeedback {conversationId, messageId, rating: "helpful"|"unhelpful", correctionIntent?: <learnable intent>}` -> `{recorded: bool, reason?: "off"|"not-needed"|"opted-out"|"not-safe-to-keep"|"duplicate"|"user-cap"|"daily-cap"}`. `messageId` is the assistant message id from `aiGetConversation`.
* `aiSetLearningOptOut {optOut: bool}` -> `{optOut}`.
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
* **No app UI** for feedback or opt-out yet; the callables are ready. Collection must stay off until the privacy notice mentions this feature.
* Cross-instance cache: other instances see a disable/revoke within 60 s.
* Anonymous candidates cannot be withdrawn individually (see Erasure).
* The Firestore rules change is covered by the added rules-test paths, but the emulator suite cannot run in this environment; run `npm test` in `security-rules` on your machine.
* Candidates are counted per distinct user per day, so counts are an indication of demand, not a vote.
