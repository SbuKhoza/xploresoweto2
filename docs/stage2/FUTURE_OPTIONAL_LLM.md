# Future optional language-model integration (design only, not implemented)

Nothing here exists in code. No provider is chosen, no paid service is added, and no Anthropic or OpenAI dependency is present. This describes where a model could attach later without changing the trusted core.

## Principle

Retrieval, security, ranking, recommendations and itineraries never depend on a model. They already produce a complete, correct answer. A model would only be an **optional wording layer** that receives the finished structured result and may rephrase it.

## Where it would attach

`engine.respond()` returns `{ blocks, evidence, followUps, bookingOffers, ... }`. A future adapter would sit between `respond()` and `chat.js`:

```
adapter.rewrite({ language, blocks, evidence })  ->  blocks'
```

Contract it would have to meet:

1. Input is only the already-retrieved, already-cleaned blocks and evidence (never raw collections, never user records).
2. Output must be validated against the evidence: every name, price, hour and rating in the output must appear in the evidence; otherwise the original template blocks are used.
3. It must not add availability, booking confirmation or travel-time claims (reuse `engine/safety.js` RE).
4. It must be switchable by config (`enabled` flag per adapter) and must fail open to the template answer on any error or timeout.
5. A provider key would be a server-side secret bound only to the function that calls the adapter, with an independent spend limit, as an explicitly approved change.

Adding it would need: a decision, a budget, a provider review, a privacy-notice update (user text would leave Firebase), and new tests. None of this has been started.
