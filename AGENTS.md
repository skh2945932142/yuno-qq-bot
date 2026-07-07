# Repository Guidelines

## Project Overview

This repository is a Node.js ES module QQ bot driven by the unified Yuno Core message workflow. OneBot/NapCat events, AstrBot integration, automation tasks, group operations, memory, RAG, tools, and reply formatting should all flow through the shared persona core instead of creating parallel reply paths.

Primary runtime flow:

```text
src/index.js
  -> src/bootstrap-phase1.js
  -> src/message-workflow.js
```

AstrBot and other external orchestration integrations should enter through `src/yuno-core.js`, which reuses `src/message-workflow.js`.

## Common Commands

- `npm install` - install dependencies.
- `npm run doctor` - check required environment and service readiness.
- `npm run smoke` - run smoke checks.
- `npm test` - run the Phase 1 regression suite via `run-phase1-tests.js`.
- `npm start` - start the bot with `node src/index.js`.
- `npm run dev` - start the bot in Node watch mode.
- `npm run kb:sync` - sync the knowledge base when enabling or refreshing RAG content.

## Development Guidance

- Prefer existing workflow modules and helpers over new parallel abstractions.
- Keep persona, prompt, reply length, and formatting behavior centralized through Yuno Core, `src/prompt-builder.js`, `src/reply-length.js`, and `src/yuno-formatter.js`.
- Keep external capabilities focused on obtaining results; the final wording should still be handled by the Yuno workflow.
- Add or update nearby `phase1-*.test.js` tests for behavior changes. Use `npm test` as the baseline regression command.
- Do not commit secrets from `.env`. Use `env.server.example` and `env.docker.example` as references for configuration.
- Treat `reports/`, `node_modules/`, `deploy/astrbot/data/`, and local environment files as generated or local-only.

## Git Notes

At initialization time, this repository was on `main` and ahead of `origin/main` by one commit. Always check `git status` before editing, and preserve unrelated user or generated changes.
