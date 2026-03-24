# Yuno QQ Bot

QQ bot with unified message workflow, configurable trigger policy, Qdrant-backed RAG, queue-ready execution, and structured observability.

## Current Architecture

```text
src/
  adapters/         inbound platform event normalization
  astrbot-yuno-plugin.js
                    AstrBot-facing plugin wrapper around Yuno Core
  chat/             session and message identity helpers
  knowledge-base.js markdown -> embeddings -> Qdrant indexing and retrieval
  message-analysis.js
                    hard rules + heuristic scoring + lightweight classifier
  message-workflow.js
                    main reply and persist orchestration
  yuno-core.js      platform-agnostic conversation entry for external orchestrators
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
- Exposes a platform-agnostic `runYunoConversation(...)` entry so AstrBot or other orchestrators can reuse the same persona core.

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
- `SPECIAL_USERS_JSON`
- `MEME_ENABLED`
- `MEME_AUTO_COLLECT`
- `MEME_AUTO_SEND`
- `MEME_STORAGE_DIR`
- `MEME_ENABLED_GROUPS`
- `MEME_OPT_OUT_USERS`
- `MEME_REQUIRE_ADMIN_FOR_AUTO_MODE`

`SPECIAL_USERS_JSON` lets you bind special persona overlays by `userId`. Example:

```json
[
  {
    "userId": "123456789",
    "label": "Scathach",
    "personaMode": "exclusive_adoration",
    "toneMode": "flirtatious_favorite",
    "affectionFloor": 88,
    "addressUserAs": "斯卡哈",
    "addressBotAs": "由乃",
    "knowledgeTags": ["persona", "special_user:scathach", "scathach"],
    "triggerKeywords": ["教导我", "徒弟", "只看我", "别看别人", "师父"],
    "memorySeeds": ["约定", "教导", "由乃会记住斯卡哈的一切"],
    "groupStyle": "群聊里更克制地护短、吃醋和偏爱，不刷屏。",
    "privateStyle": "私聊里更黏人、更暧昧，喜欢引用记忆和约定，但不进入现实威胁。"
  }
]
```

## Scripts

```bash
npm test
npm run eval
npm run kb:sync
```

- `npm test` runs legacy tests plus the Phase 1/2 workflow, trigger, queue, and retrieval tests.
- `npm run kb:sync` reads Markdown documents from `knowledge/`, chunks them, embeds them, upserts them into Qdrant, writes a manifest, and removes orphan chunks.

## AstrBot Integration

- `src/yuno-core.js` is the stable integration surface for outer orchestrators.
- `src/astrbot-yuno-plugin.js` is a minimal AstrBot-style wrapper that:
  - adapts an AstrBot message context
  - calls `runYunoConversation(...)`
  - returns structured output while keeping persona formatting inside Yuno Core
- `src/astrbot-plugin-router.js` provides same-process plugin routing for:
  - `yuno-meme`
  - `yuno-status`
  - `yuno-knowledge`
  - `yuno-schedule`
  - `yuno-chat`
- Recommended layering:
  - AstrBot handles routing, plugins, permissions, and external tools.
  - Yuno Core handles trigger analysis, memory, retrieval, emotion, special-user policy, and final reply style.

## Trigger Rules

- Group chat is conservative by default and now requires an explicit trigger before replying:
  - direct `@bot`
  - known keywords
  - slash commands such as `/profile`, `/emotion`, `/command`
  - QQ poke notifications targeting the bot
- Private chat still defaults to reply mode unless you override the trigger policy.
- The built-in `/command` alias is available through the query tool registry and returns the current command list.

## Meme Phase 1

- Same-process meme support is split into collection, retrieval, generation, and decision modules under `src/meme-*.js`.
- Phase 1 supports:
  - collecting image assets from enabled groups
  - tagging and retrieving meme candidates
  - generating a single-message fake chat screenshot as SVG
  - routing the final text + image back through Yuno Core formatter
- Automatic meme sending is disabled by default. Enable it explicitly with `MEME_AUTO_SEND=true`, and keep group allowlists / opt-out lists configured.

## Operational Notes

- Retrieval is live, not just a boundary placeholder. The active knowledge path is `knowledge/ -> embeddings -> Qdrant -> retrieveKnowledge()`.
- If `ENABLE_QUEUE=false` or BullMQ dependencies are unavailable, the app falls back to inline execution while keeping the same queue API.
- `/ready` reports database and queue readiness. `/metrics` exposes Prometheus-style counters and histograms.
- The old `src/workflows/group-message-workflow.js` remains only as compatibility code; the active runtime path is `src/message-workflow.js`.

## Future Extension Points

- Add new tool definitions in `src/tool-config.js` and executors in `src/query-tools.js`.
- Replace inline fallback with dedicated worker processes if you want reply/persist queues in separate runtimes.
- Extend `knowledge/` with richer domain docs, FAQs, and roleplay/world references.
