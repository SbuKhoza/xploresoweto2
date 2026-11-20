> **SUPERSEDED (Stage 2B).** This document describes the Stage 2A design that called a paid external language-model API. That architecture was **withdrawn**: Stage 2B replaced it with a database-powered engine that needs **no** API key, secret or paid AI service. Nothing below is part of the current system, and **none of the setup, key-creation or deployment instructions in it should be followed**. It is kept only as history. Current documents: `README.md` in this folder.

# Stage 2A: verification record (checked 2026-11-18, before any provider code was written)

Nothing below is assumed from memory: each item was read from Anthropic's published documentation or the installed SDK types.
The values are defaults in `functions/src/ai/config.js` and are **overridable at runtime** (`ai-config/default`), so a model
rename or price change never needs a redeploy. Re-verify before every production release; Anthropic's pages are authoritative.

## Models (docs: platform.claude.com/docs/en/models/{sonnet-5-5,haiku-5-5}/overview)
| Purpose | Model id (Claude API) | Context / max output | Default effort | Notes |
|---|---|---|---|---|
| routine | `claude-haiku-5-5` | 1M / 128K | `medium` | adaptive thinking; omit `temperature`, `top_p`, `top_k` |
| planning | `claude-sonnet-5-5` | 1M / 128K | `high` | adaptive thinking; setting `temperature`/`top_p`/`top_k` returns HTTP 400 |
Both: minimum cacheable prompt 512 tokens; active, retirement not sooner than Sept/Oct 2027.

## Prices, USD per million tokens (docs list the same figures for the Claude API)
| Model | Input | Output | 5-min cache write | Cache read |
|---|---|---|---|---|
| Haiku 5.5 (prompt ≤ 100K) | 0.10 | 0.50 | 0.125 | 0.01 |
| Haiku 5.5 (prompt > 100K) | 0.50 | 2.50 | 0.625 | 0.05 |
| Sonnet 5.5 | 2 | 10 | 2.50 | 0.10 |
**Correction to the Stage 2 assessment:** it quoted the Sonnet 5.5 cache-read price as $0.20/MTok from a search snippet. The official
page says **$0.10/MTok**. Costs in the code are computed from the verified table; the real spend limit is the Anthropic workspace
limit, our estimate is a second line of defence.

## API parameters (docs: build-with-claude/effort, tool-use pages; SDK `@anthropic-ai/sdk` 1.10.0 type definitions)
* Effort is `output_config.effort` ∈ `low | medium | high | xhigh | max`. Docs recommend `medium` or `low` for chat and latency-sensitive work. Effort applies to all output tokens including tool calls and thinking; **thinking counts toward `max_tokens`**, so token caps leave headroom.
* Changing top-level effort between requests can invalidate the prompt cache: effort is therefore fixed per purpose, never varied inside a conversation turn.
* Forced tool choice (`tool_choice` `any`/`tool`) returns HTTP 400 on Sonnet 5.5 and Opus 5.5: the code only ever uses automatic tool choice.
* `stop_reason` ∈ `end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded`; all are handled.
* `usage`: `input_tokens`, `output_tokens` (the inclusive, authoritative total for billing), `cache_creation_input_tokens`, `cache_read_input_tokens`.
* Per-request `timeout`, `maxRetries` and `signal` are supported; retries are done by our code (`maxRetries: 0`) so every retry is counted and bounded.
* Tool-use loop: the model returns `stop_reason: "tool_use"`; our server runs the tool and replies with a `tool_result`. Assistant content (including thinking blocks) is passed back unchanged between loop steps.

## Secrets (Firebase docs)
Secrets are declared with `defineSecret` from `firebase-functions/params`, bound per function via the `secrets` option, set with
`firebase functions:secrets:set`, and read locally from `functions/.secret.local` (git-ignored). Only `aiChat` binds the key.
