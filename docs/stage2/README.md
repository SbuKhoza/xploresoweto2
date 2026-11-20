# Stage 2 documentation index

**Current system (Stage 2B): a database-powered assistant.** It answers from public, published XploreSoweto records with deterministic code. It calls **no** language model or external AI service, so there is **no API key, no secret and no per-message AI cost**.

| Document | Status | What it covers |
|---|---|---|
| `STAGE2B_ARCHITECTURE.md` | Current | Architecture, module responsibilities, supported intents, collections and fields used, public-data retrieval rules, response generation, security, limitations |
| `STAGE2B_TESTING_AND_COSTS.md` | Current | What the tests prove and how to run them, Firebase services and costs that still apply |
| `FUTURE_OPTIONAL_LLM.md` | Current (design only, **not implemented**) | How a language model could be attached later without touching retrieval, ranking, itineraries or security |
| `STAGE2B_DEPLOYMENT_NOTES.md` | Current (**nothing deployed**) | What would be deployed later and what needs approval first |
| `STAGE2B_PHASE1_AUDIT.md` | Historical record (one correction marked) | The audit that preceded the pivot |
| `STAGE2A_SETUP_AND_DEPLOYMENT.md`, `STAGE2A_REVIEW_REPORT.md`, `VERIFICATION_RECORD.md` | **SUPERSEDED, do not follow** | The withdrawn Stage 2A design that used a paid model API. Kept as history only. |

The assistant is **not** a trained conversational language model. It is rule-based: it detects intents with patterns, extracts values with parsers, retrieves records, ranks them with published weights and fills fixed templates. It understands the phrasings it was written for and falls back to asking or saying it is unsure for the rest.
