# Installation Guide

Deploy one Koishi + Yuno Node.js application together with LLBot, MongoDB, and optional Qdrant/Redis. Koishi is the only OneBot client, and queue workers plus the scheduler remain in the application process.

Prerequisites: Node.js 22+, MongoDB, LLBot with OneBot 11 positive WebSocket enabled, and optional Qdrant/Redis. FFmpeg is required only for voice replies.

Run `npm ci`, copy `env.server.example` to `.env`, configure the variables in `docs/environment-variables.md`, and set `ONEBOT_ENDPOINT` to LLBot's private WebSocket URL. New deployments may begin in shadow mode to validate Session mapping; production uses active mode.

The final Zeabur service set is:

`mongodb`, `llbot`, `yuno-qq-bot`, and `Qdrant-omiste`.

Do not expose the LLBot WebUI publicly. Keep port `3000` private, persist `/app/llbot/data`, and validate `/ready`, a real inbound reply, Delivery Ledger status, metrics authentication, and scheduled delivery before declaring the deployment healthy.
