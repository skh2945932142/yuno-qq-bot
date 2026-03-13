# Yuno QQ Bot

Lightweight QQ group bot focused on stable chat, structured state, and a clean path toward future agent and business workflow capabilities.

## Current Architecture

```text
src/
  agents/          task planning and routing
  api/             HTTP app and webhook handlers
  core/            bootstrap and runtime wiring
  jobs/            background and scheduled jobs
  memory/          memory/state access boundary
  observability/   trace helpers and execution visibility
  prompts/         prompt entrypoints and prompt version constants
  retrieval/       retrieval boundary for future RAG support
  schemas/         webhook and tool schemas
  state/           group-state access boundary
  tools/           tool registry and tool implementations
  workflows/       end-to-end orchestration
  services/        existing domain logic retained for compatibility
```

## What This Project Does Today

- Receives OneBot group message webhooks.
- Decides whether the bot should respond using rule-based gating plus optional model analysis.
- Maintains layered state:
  - long-term relation
  - short-term user emotion
  - group state and recent events
- Supports structured query tools for:
  - relation snapshot
  - current emotion
  - group state
  - profile summary
- Sends scheduled proactive messages for the target group.
- Logs workflow traces, model usage, tool execution, and failures.

## Run

```bash
npm install
npm start
```

Required environment variables:

- `MONGODB_URI`
- `SILICONFLOW_API_KEY`
- `NAPCAT_API`

Optional:

- `TARGET_GROUP_ID`
- `ADMIN_QQ`
- `YUNO_VOICE_URI`
- `ENABLE_VOICE`
- `FFMPEG_PATH`
- `REQUEST_TIMEOUT_MS`
- `RETRY_ATTEMPTS`
- `RETRY_DELAY_MS`

## Scripts

```bash
npm test
npm run eval
```

`npm test` runs unit and architecture tests.

`npm run eval` runs lightweight scenario evaluations for:

- webhook schema validation
- trigger analysis
- command-to-tool routing

## Operational Notes

- Voice is optional and can be disabled with `ENABLE_VOICE=false`.
- Retrieval/RAG is not enabled yet; the project now has a retrieval boundary in `src/retrieval/` so business knowledge retrieval can be added without polluting the chat workflow.
- The project intentionally keeps the existing stack and avoids heavy framework additions.

## Future Extension Points

- Add business tools into `src/tools/` and register them in the shared registry.
- Add workflow-specific planners under `src/agents/` or `src/workflows/`.
- Add retrieval adapters in `src/retrieval/`.
- Expand eval scenarios in `evals/scenarios.json`.
