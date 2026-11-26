# Malloya conversation engine: root causes and fixes (staging real-device findings)

Scope: the deterministic engine in `functions/src/ai/engine/` plus the staging banner. No model, no network, no paid calls. Luna files,
security rules, rate limits, budget protections and environment isolation are unchanged (a test asserts the Luna and rules diff is empty).

| # | Symptom | Root cause (reproduced by a failing test first) | Fix |
|---|---|---|---|
| 1 | "Where can I stay?" gave the generic fallback | Accommodation patterns only matched "where/place **to** stay". "Where **can I** stay", "somewhere to sleep", "need a room" matched nothing, so intent was `unknown` | Wider phrase coverage for accommodation (and the same for eating, attractions, activities) in `intents.js` |
| 2 | "Show me places to eat" returned events | The events pattern `(festival\|concert\|gig\|show)s?` matched the word **show** in "**Show** me". Events outranked the weaker restaurant match | Bare "show" removed from events; events need real event words ("live show", "concert", "what's on"). "places to eat/dine", "somewhere to grab lunch" now score as restaurants |
| 3 | Vilakazi Street sentence got a township overview | No concept of a destination. "traveling with" matched no plan pattern, so the text went to a township-guide substring search where "st" matched unrelated passages | New `explore_place` intent plus landmark recognition (`landmarks.js`, names only, no facts). Answers from records that really mention the place, or says there is none, then asks what the person wants. Guide passages are accepted only on a whole-word match |
| 4 | Same unanswered question gave the same reply | The fallback was one fixed string and the context did not record unanswered turns | Context now holds `misses`. The fallback wording and suggestions change on each repeat and always ask a specific question |
| 5 | Malloya's own suggestions were not understood | Several suggested questions had no route: "I'm travelling with 2 people" (a detail, no request), "Which of these has the lowest listed price?" (resolved to the first item only), "Plan a day using these" (ignored the shown places). Suggestions were also static, e.g. "the first one" after a no-match | Detail-only messages are accepted and re-run the previous search; plural references compare what was just shown (or say nothing was shown); "using these" plans from the shown places; suggestions depend on what was shown. A test sends every suggestion back as a user message |
| 6 | Fallback showed "From our listings" | `composeStatic` (greeting, help, unknown) built `verified` blocks, and the app labels `verified` as "From our listings" | Text that comes from no record is now type `general` (no badge). Clarifying questions are `general` too. Only blocks with retrieved records are `verified`; a test enforces it |
| 7 | Staging banner overlapped the Malloya header | The banner was placed at `top: insets.top`, i.e. inside the screen content where headers start | Banner now sits in the status-bar strip (`top: 0`, height at most the top inset). The warning is still always visible |

Also fixed on the way: "where can I eat in Kliptown" used to answer for all of Soweto without saying Kliptown matched nothing; it now says so.

## Behaviour rules now enforced
* The current message decides the request; earlier context only fills details it does not state (place, party, budget...).
* Temporary trip details (destination, group size) live only in the conversation's own context document. Only the group size is kept, never the
  relationship word. Nothing is written to a profile or memory (a test checks that the engine writes no documents).
* Nothing is invented: prices, hours, distances and availability only appear from stored records; no-match answers say so.
* Abbreviations and typos are repaired before matching ("Vilakazi St", "resturants"); the repair is conservative (long vocabulary words, edit distance 1).

## Known limits
* English only. isiZulu is still detected and answered in English.
* Landmark recognition is a small table (`landmarks.js`); streets not in it are handled by the generic "named place" path and honest no-match text.
* Greeting and thanks wording is pinned by the optional Luna template and was deliberately not reworded.
* Luna remains disabled in staging; nothing here calls a provider.
