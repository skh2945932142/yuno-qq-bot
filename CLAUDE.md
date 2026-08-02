# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

One Node.js ES module process (`"type": "module"`, Node 22+) running Koishi and Yuno together. Koishi is the only OneBot 11 client and the only QQ delivery boundary. Yuno owns persona, trigger policy, memory, RAG, tools, queue workers, scheduler, and reply formatting.

```text
QQ <-> LLBot (OneBot 11 positive WebSocket) <-> Koishi + Yuno <-> MongoDB
                                                             <-> Qdrant (optional)
                                                             <-> Redis (optional)
```

## Commands

```powershell
npm ci
npm start                 # node src/index.js
npm run dev               # node --watch
npm test                  # whole suite, single process
npm run doctor            # live preflight: Mongo, LLM, Redis, Qdrant, ffmpeg, OneBot WS
npm run smoke:mock        # full conversation through mocked deps, no network
npm run smoke             # same path against real services
```

Single test file — plain `node:test`, no runner config:

```powershell
node phase1-workflow.test.js
node --test --test-name-pattern "resolveReplyCadence" phase1-reply-cadence.test.js
```

`npm test` runs `run-phase1-tests.js`, which sequentially imports `test/run-tests.js` and every root-level `phase1-*.test.js`. **A new test file must be registered in one of those two index files or CI will never run it.** Tests import `src/config.js`, which loads `.env`, so a local `.env` can shift env-derived defaults.

Other scripts:

- `npm run test:coverage:ci` — gates from `scripts/check-coverage.js`: `src/` ≥80% lines, ≥70% branches, ≥80% functions, plus per-file 80/70 gates on `message-workflow.js`, `message-analysis.js`, `sender.js`, `queue-manager.js`, `koishi-session-adapter.js`, `koishi-adapters.js`.
- `npm run eval` — offline trigger/routing behavior over `evals/scenarios.json`.
- `npm run eval:style` — deterministic reply-style and naturalness gate; `eval:style:model` additionally calls the real reply model.
- `npm run security:audit`, `npm run security:secrets` — dependency audit (allowlist in `security/`) and tracked-file secret scan.
- `npm run kb:sync` — chunk and embed `knowledge/**/*.md` into Qdrant. `npm run meme:import` — load `data/qq-favorite-memes`.
- `npm run benchmark:reply`, `npm run automation:ideas`, `npm run automation:dev-health`.

No linter or formatter is configured. CI (GitHub Actions and CircleCI, Node 20) runs `npm test` → coverage gates → `smoke:mock` → `eval` → `eval:style` → security audit → secret scan.

## Boot chain

`src/index.js` → `src/koishi-app.js` → `src/koishi-yuno-plugin.js` → `src/yuno-runtime.js` → `src/yuno-core.js` → `src/inbound-event-service.js` → `src/message-workflow.js`

- `koishi-app.js` builds the Koishi `Context` (Server/Http/Mongo, optional Console+Auth, the OneBot adapter) and installs `/health`, `/ready`, `/metrics`. It validates Koishi-side env through `requireKoishiConfig`.
- `koishi-yuno-plugin.js` registers a single `ctx.middleware`: `/koishi` admin commands (ADMIN_QQ only), then downstream Koishi commands win, then eligible events go to Yuno.
- `yuno-runtime.js#initializeYunoRuntime` is the one lifecycle owner: `validateRuntimeConfig` → Mongo → telemetry → queue manager → readiness probes (Qdrant, voice) → delivery ledger → `setRuntimeServices` → start workers → start scheduler.
- `YUNO_PLUGIN_MODE=shadow` only logs Session mapping: no runtime init, no LLM call, no delivery, no writes. `active` is production.

## Two boundaries, and nothing crosses them

Inbound: `src/koishi-session-adapter.js#adaptKoishiSession` is the only translator from a Koishi Session into the unified event shape defined by `src/chat/session.js#normalizeLegacyMessageEvent`. Everything downstream assumes that shape. Notices become synthetic commands: poke → `/poke`, member-added → `/welcome`.

Outbound: `src/koishi-adapters.js` (`createKoishiDeliveryAdapter`, `createKoishiProtocolAdapter`) is the only code that touches Koishi bots or raw OneBot actions; `src/sender.js` is the facade workflow code calls. Optional OneBot actions (`set_input_status`, `set_msg_emoji_like`) permanently self-disable after their first failure, so protocol builds lacking them degrade once instead of erroring per message.

## Dependency injection

Nearly every workflow function takes a `deps` object, and `createWorkflowDeps()` in `message-workflow.js` fills in production implementations. Tests and `scripts/smoke-mock.js` override deps rather than mocking modules — that is why the suite runs with no Mongo, Redis, or network. Follow the pattern when adding behavior.

`src/runtime-services.js` is a small service locator for what cannot be threaded through arguments: `queueManager`, `deliveryLedger`, `readiness`, `deliveryAdapter`, `protocolAdapter`. `initializeYunoRuntime` sets it; shutdown clears it.

## Reply pipeline

`src/message-workflow.js` (~2.6k lines) is the heart. In traces and logs the stages surface as `withTraceSpan` names such as `load-context`, `execute-tool`, `retrieve-knowledge`, `build-prompt`, `generate-reply`, `send-text`, `tts`, and `send-voice`.

1. **Aggregate** — `message-aggregator.js` debounces bursts of consecutive messages per chat and merges them into one event before the workflow runs.
2. **Trigger** — `analyzeTriggerFast` (rules only) then `analyzeTrigger` (LLM classifier) in `message-analysis.js`, both driven by `trigger-policy.js` (`DEFAULT_TRIGGER_POLICY`, overridable at runtime via `TRIGGER_POLICY_JSON`). Private chat auto-allows; group chat requires an explicit trigger and only consults the classifier inside a score window.
3. **Participate** — `inbound-event-service.js` runs group observation and group-automation rules concurrently with the decision, then `participation-policy.js` may downgrade an approved reply to an emoji `reaction` or `skip` it so Yuno does not over-talk.
4. **Context** — `buildWorkflowContext` loads relation, user state, profile memory, conversation state, group state, recent group events, and vector memory in one `Promise.all`. Commands and pokes take a lightweight variant.
5. **Route** — `task-router.js#planIncomingTask` yields either a tool task (command → `tool-config.js#TOOL_DEFINITIONS` → `query-tools.js` executor via `tools/registry.js`) or a chat route (`private_chat`, `group_chat`, `knowledge_qa`, …).
6. **Generate** — the persona layer (`emotion-engine.js`, `daily-mood.js`, `personality-strategy.js`, `persona-policy.js`, `reply-length.js`, `reply-intent-plan.js`, `reply-style-retriever.js`) is assembled by `prompt-builder.js#buildReplyContext` and sent through `minimax.js#chat`, which wraps the OpenAI-compatible SDK with separate analysis and reply model configs, a circuit breaker, and a fallback model.
7. **Gate** — `reply-naturalness.js` inspect → polish → deescalate, plus an optional LLM style rewrite, `stripHiddenReasoning`, an emoji budget, and markdown stripping.
8. **Deliver** — `reply-segmenter.js` splits the reply into chat bubbles, `reply-cadence.js` computes human-like pre-delay and inter-bubble pauses (seeded RNG, collapses under a tight budget), `resolveGroupReplyQuoteId` decides whether to quote, then optional meme image (`meme-*.js`) and optional voice (`minimax.js#tts` → `services/audio.js` → Tencent silk).
9. **Persist** — `persistReplyState` writes relation, user state, conversation, profile memory, and memory events, deferred onto the persist queue (`processPersistJob`) when enabled.

## Cross-cutting invariants

**Delivery is idempotent.** Every user-visible send goes through `delivery-ledger.js#executeTrackedDelivery` with the key `platform:chatType:chatId:sourceMessageId:kind`, backed by the leased `DeliveryRecord` collection. Multi-part plans record completed parts so a retry resumes instead of resending. Do not call `sender.js` directly for a reply.

**Reply time is budgeted.** `REPLY_PRIMARY_TIMEOUT_MS` and `REPLY_HARD_TIMEOUT_MS` bound generation. On exhaustion the workflow emits a prepared variant from `reply-variants.js` rather than failing, and cadence compresses its delays.

**Optional infrastructure degrades, never throws.** Qdrant retrieval returns `{ enabled: false, reason }`, voice is skipped when ffmpeg is missing, and `queue-manager.js` silently falls back from BullMQ to an inline in-process manager when Redis is unreachable. `/ready` reports these as `degraded` rather than failing.

**Workers stay in-process.** `ENABLE_QUEUE` and `REDIS_URL` only change the queue backend. Reply/persist workers and `scheduler.js` (→ `jobs/scheduler-job.js`: proactive interaction, daily digest, due reminders and subscriptions claimed with a Mongo lock) always run here. Production runs exactly one replica.

## Data

All Mongo models live in `src/models.js`: Relation, History, UserState, GroupState, GroupEvent, ConversationState, UserProfileMemory, UserMemoryEvent, MemeAsset, GroupAutomationRule, AutomationTask, DeliveryRecord. Koishi uses a separate database (`KOISHI_MONGODB_URI`) from Yuno (`MONGODB_URI`).

Qdrant serves two independent consumers through `qdrant-client.js`: `knowledge-base.js` (Markdown under `knowledge/`, synced by `npm run kb:sync`; files may carry `Tags:` / `Priority:` headers) and `memory-retrieval.js` (user memory events and meme semantics).

## Config

`src/config.js` reads env once at import and freezes the result, with a provider-detection default chain (GEMINI → SILICONFLOW → OPENAI) for base URLs and models. Never mutate `config`; pass `runtimeConfig` through options instead — that is how tests and per-request overrides work. `docs/environment-variables.md` is the reference.

## Hard constraints

- Do not add AstrBot plugins, a Yuno HTTP conversation API, standalone worker roles, a second scheduler, or direct OneBot HTTP calls from Yuno.
- Keep Session conversion in `koishi-session-adapter.js`, delivery and protocol calls behind `koishi-adapters.js` and `sender.js`, and behavior in the central workflow modules.
- Add regression tests for behavior changes and register new test files in `run-phase1-tests.js`.
- `src/prompt-builder.js.bak` is gitignored dead weight; leave it alone.
- For changes that affect ingress, roll out in `YUNO_PLUGIN_MODE=shadow`, validate Session mapping, then switch atomically to `active`. Run `npm test`, `npm run smoke:mock`, and `npm run doctor` before deployment (`DEPLOYMENT_CHECKLIST.md`).

## User-visible copy

`docs/copy-style.md` governs every string a user can see: Yuno's voice, Simplified Chinese, one to three sentences for tool replies, keep the key numbers, no system-announcement or support-desk tone. It binds `yuno-formatter.js`, `query-tools.js` fallback messages, and prompt text — not logs or trace fields. `evals/reply-style-scenarios.json` plus `npm run eval:style` is the enforcement path.
