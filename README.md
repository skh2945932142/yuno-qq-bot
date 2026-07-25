# Yuno QQ Bot

Yuno runs as one Koishi + Yuno Node.js application. Koishi is the only OneBot 11 client and QQ delivery boundary; Yuno remains the persona, memory, RAG, tool, queue, scheduler, and final reply core.

## Architecture

~~~text
QQ <-> LLBot (OneBot 11 positive WebSocket) <-> Koishi + Yuno <-> MongoDB
                                                         <-> Qdrant (optional)
                                                         <-> Redis (optional)
~~~

There is no AstrBot runtime, Koishi-to-Yuno HTTP bridge, standalone Yuno HTTP service, or direct Yuno OneBot sender.

## Message Flow

1. Koishi connects to LLBot's private OneBot WebSocket server with ONEBOT_TOKEN.
2. LLBot forwards OneBot events and accepts action calls over the same connection.
3. The Yuno plugin maps the Session with adaptKoishiSession().
4. runYunoConversation() performs trigger policy, memory, RAG, tools, generation, and formatting.
5. The Delivery Ledger claims delivery and the Koishi Delivery Adapter sends through SELF_QQ.
6. Persistence continues through the in-process queue when enabled.

Scheduled messages use the same Yuno workflow and Delivery Adapter.

## Setup

~~~powershell
npm ci
Copy-Item env.server.example .env
npm start
~~~

Configure SELF_QQ, ADMIN_QQ, ONEBOT_TRANSPORT=ws, ONEBOT_ENDPOINT, ONEBOT_TOKEN, KOISHI_MONGODB_URI, MONGODB_URI, console credentials, metrics token, and model credentials. Use separate koishi and yuno MongoDB databases.

Start with YUNO_PLUGIN_MODE=shadow. Shadow mode only validates Session mapping; it starts no Yuno workers or scheduler, calls no LLM, sends no QQ messages, and writes no memory. After validation set YUNO_PLUGIN_MODE=active.

## Operations

- GET /health: liveness.
- GET /ready: runtime, MongoDB, configured OneBot bot, queue, and scheduler readiness. Qdrant or voice failure is reported as degraded rather than blocking text chat.
- GET /metrics: requires x-yuno-metrics-token.
- /koishi status: restricted to ADMIN_QQ.
- Production uses one application replica. Redis can back BullMQ, but workers stay in this process.

Expose LLBot's OneBot WebSocket only on the private network. Set ONEBOT_ENDPOINT to its ws:// address and use MEME_PROVIDER=local-cache; QQ favorite synchronization is not part of the LLBot runtime.

## Testing

~~~powershell
npm run doctor
npm run smoke:mock
npm test
~~~

See docs/environment-variables.md and DEPLOYMENT_CHECKLIST.md for the migration rollout and LLBot replacement procedure.