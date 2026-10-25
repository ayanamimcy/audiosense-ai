# LLM observability

Every LLM request made through [`lib/ai/llm.ts`](../lib/ai/llm.ts) (summaries, tag
suggestions, recording chat, Ask AI) writes one row to `llm_calls`. Settings › System status
shows the aggregates; the raw API is `GET /api/llm/usage?days=7`.

## What is recorded

| Field | Why |
|---|---|
| `operation`, `model`, `providerHost` | Which feature, which model, which endpoint (host only, never the key) |
| `promptVersion` | `operation@<hash>` of the instructions: system prompt plus the summary template. Editing a prompt yields a new version automatically, so the effect of a prompt change can be compared without manual version bookkeeping. Transcript text is not part of the hash. |
| `latencyMs`, `firstTokenMs` | Total time, and for streams the time to the first token, which is what the user perceives as "speed" in chat |
| `inputTokens`, `outputTokens`, `usageSource` | Provider-reported usage when available (`provider`), otherwise an estimate from text length (`estimated`, ~4 chars/token for Latin, ~1 token per CJK character) |
| `status`, `errorCategory`, `httpStatus` | `ok` / `error` / `cancelled`; errors are bucketed into timeout, rate_limited, auth, client, server, network, empty_response |
| `taskId`, `userId` | To answer "what did this recording cost" and to scope the stats per user |

**Not recorded:** prompts, transcripts, answers. Recordings are private, and the questions
above can be answered without them.

## Decisions

- **Streams request usage.** Streaming calls send `stream_options: { include_usage: true }`
  so the final SSE frame carries token counts. Some OpenAI-compatible servers reject unknown
  fields: on a 400/422 the call is retried once without the option, and the host is
  remembered only when that retry succeeds (a genuine 400 just fails again).
- **Tracing never breaks the feature.** Rows are written fire-and-forget; a failed insert is
  logged and the user's request proceeds.
- **Cost is computed at read time.** Prices come from the optional `LLM_PRICING_JSON`, not
  from the database, so changing a price re-prices history and a missing price shows "—"
  instead of a wrong number. It is labelled as an estimate everywhere: providers bill
  differently (cached tokens, minimums), and estimated token counts are approximate.
- **Latency percentiles use successful calls only.** A timeout's latency is the timeout
  setting, not the model's speed; failures show up in the error rate instead.
- **Aggregation is in memory.** Fine for a personal or team workspace; a larger deployment
  would push it into SQL or an analytics store.

## Not covered yet

The subtitle-splitting LLM client, query enhancement, reranking and embeddings call their
providers directly and are not traced yet. Transcription providers are covered separately by provider
health (success/failure counts, circuit breaker) rather than this table.

Tests: [`tests/llm-observability.test.ts`](../tests/llm-observability.test.ts), which run real
calls against a fake OpenAI-compatible server.
