# Yuno QQ Bot

QQ bot with unified message workflow, configurable trigger policy, Qdrant-backed RAG, queue-ready execution, and structured observability.

## Current Architecture

```text
src/
  adapters/         inbound platform event normalization
  chat/             session and message identity helpers
  knowledge-base.js markdown -> embeddings -> Qdrant indexing and retrieval
  message-analysis.js
                    hard rules + heuristic scoring + lightweight classifier
  message-workflow.js
                    main reply and persist orchestration
  queue-manager.js  BullMQ / inline queue abstraction
  runtime-tracing.js
                    trace lifecycle and span timing
  metrics.js        Prometheus-style metrics registry
  query-tools.js    configurable tool registration for built-in query tools
  tool-config.js    declarative command/tool metadata
```

## What This Project Does Today

- Receives OneBot group/private message webhooks.
- Normalizes inbound events into a unified QQ message format.
- Decides whether to reply using:
  - hard rules
  - configurable heuristic weights and thresholds
  - a lightweight trigger classifier for borderline cases
- Routes messages into:
  - command tools
  - knowledge/RAG replies
  - follow-up replies
  - cold-start chat
  - normal group/private chat
- Maintains:
  - short-term conversation state
  - relation and emotion state
  - long-term user profile memory
  - group state and recent events
- Indexes Markdown knowledge under `knowledge/` into Qdrant and retrieves matching chunks at reply time.
- Exposes `/health`, `/ready`, and `/metrics`.
- Supports queue-backed reply/persist jobs through BullMQ when Redis is enabled, with inline fallback for local development and tests.

## Run

```bash
npm install
npm start
```

Required environment variables:

- `MONGODB_URI`
- `SILICONFLOW_API_KEY`
- `NAPCAT_API`

Optional core runtime:

- `TARGET_GROUP_ID`
- `ADMIN_QQ`
- `SELF_QQ`
- `REQUEST_TIMEOUT_MS`
- `RETRY_ATTEMPTS`
- `RETRY_DELAY_MS`

Optional voice:

- `YUNO_VOICE_URI`
- `ENABLE_VOICE`
- `FFMPEG_PATH`

Optional retrieval:

- `QDRANT_URL`
- `QDRANT_API_KEY`
- `QDRANT_COLLECTION`
- `QDRANT_TOP_K`
- `QDRANT_MIN_SCORE`
- `QDRANT_CHAR_LIMIT`
- `EMBEDDING_MODEL`

Optional queueing:

- `ENABLE_QUEUE`
- `REDIS_URL`
- `REPLY_QUEUE_NAME`
- `PERSIST_QUEUE_NAME`
- `QUEUE_RETRY_ATTEMPTS`
- `QUEUE_BACKOFF_MS`
- `QUEUE_CONCURRENCY_DEFAULT`
- `QUEUE_CONCURRENCY_REPLY`
- `QUEUE_CONCURRENCY_PERSIST`

Optional observability:

- `ENABLE_METRICS`
- `METRICS_PATH`
- `OTLP_ENDPOINT`
- `LOG_LEVEL`
- `TRACE_SAMPLE_RATE`

Optional config overrides:

- `TRIGGER_POLICY_JSON`
- `TOOL_CONFIG_JSON`

## Scripts

```bash
npm test
npm run eval
npm run kb:sync
```

- `npm test` runs legacy tests plus the Phase 1/2 workflow, trigger, queue, and retrieval tests.
- `npm run kb:sync` reads Markdown documents from `knowledge/`, chunks them, embeds them, upserts them into Qdrant, writes a manifest, and removes orphan chunks.

## Operational Notes

- Retrieval is live, not just a boundary placeholder. The active knowledge path is `knowledge/ -> embeddings -> Qdrant -> retrieveKnowledge()`.
- If `ENABLE_QUEUE=false` or BullMQ dependencies are unavailable, the app falls back to inline execution while keeping the same queue API.
- `/ready` reports database and queue readiness. `/metrics` exposes Prometheus-style counters and histograms.
- The old `src/workflows/group-message-workflow.js` remains only as compatibility code; the active runtime path is `src/message-workflow.js`.

## Future Extension Points

- Add new tool definitions in `src/tool-config.js` and executors in `src/query-tools.js`.
- Replace inline fallback with dedicated worker processes if you want reply/persist queues in separate runtimes.
- Extend `knowledge/` with richer domain docs, FAQs, and roleplay/world references.
