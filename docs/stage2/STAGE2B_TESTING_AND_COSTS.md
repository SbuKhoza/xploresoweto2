# Stage 2B: testing and Firebase cost considerations

## Testing

Run (no key, no network, no emulator, no production connection):

```
cd functions && npm test           # node --test, in-memory Firestore fake
cd security-rules && npm run lint  # ESLint rules lint (rules emulator tests are written but need Java/emulator and were not run here)
```

Coverage (files in `functions/test/`): `engine_nlu` (intents, query extraction: budget, currency, dates, party, duration, interests), `engine_ranking` (search and filter, ranking, no paid placement, itinerary logic), `engine_answers` (response generation, labelled blocks, missing information and clarification, invalid input, public-collection and private-data restrictions, truncation, empty database, no network, the R800 example), `chat_flow` (authentication, validation, conversation ownership, idempotency, rate limiting, kill switch, admin config, booking never created), `ratelimit`, `ai_security` (no LLM dependency, read-only allow-listed retrieval, rules), `ai_conversations`, `ai_foundation`.

Not proven by these tests: behaviour against real CMS data, Firestore rules in the emulator, real latency, real Firestore read counts.

## Firebase services and costs that still apply

The assistant has **no external AI charges**. Firebase is **not** free: normal Firebase usage billing still applies and Cloud Functions requires the Blaze plan (already needed for Stage 1). Check current Firebase pricing for your region; no prices are quoted here.

| Service | Driven by |
|---|---|
| Firestore reads | Category scans (up to `retrieval.scanLimit`, default 150, per category on a cache miss), organisation status reads (one per distinct organisation in a scan), the township guide read (up to 300 documents on a cache miss), and a few conversation and usage reads per message |
| Firestore writes | Per message: the usage document (reserve and settle) and the conversation turn (user message, assistant message, conversation) |
| Cloud Functions | One invocation per message, plus the history and usage callables; compute time is short (no network wait) |
| Cloud Logging | A few log lines per message |
| Storage of conversations | Retained 90 days by default |

Controls that exist now: per-instance in-memory cache (default 300 s), scan cap with an honest "may have missed records" message, only the categories an intent needs, per-user daily (50) and burst (5/min) limits, `maxInstances` caps on callables, kill switch. A plan question can read several hundred documents on a cache miss; repeated questions on a warm instance read little. Cache is per instance, so many instances mean more reads. Later options (not built): a precomputed keyword field, a shared cache, a smaller township read.
