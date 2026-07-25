# Environment Variables

## Koishi and OneBot

| Variable | Purpose |
|---|---|
| SELF_QQ | QQ account selected for delivery and protocol actions. |
| ADMIN_QQ | User allowed to run /koishi management commands. |
| ONEBOT_ENDPOINT | OneBot HTTP API base URL. |
| ONEBOT_TOKEN | OneBot HTTP API access token. |
| ONEBOT_SECRET | OneBot event callback signature secret. |
| KOISHI_PORT | Server port, default 5140. |
| KOISHI_MONGODB_URI | Koishi database URI, normally /koishi. |
| KOISHI_CONSOLE_ENABLED, KOISHI_CONSOLE_ADMIN, KOISHI_CONSOLE_PASSWORD | Private Console configuration. |
| YUNO_PLUGIN_MODE | shadow for mapping validation; active for production. |

## Yuno runtime

| Variable | Purpose |
|---|---|
| MONGODB_URI | Yuno database URI, normally /yuno. |
| LLM_API_KEY and LLM_CHAT_MODEL | Analysis/chat model. |
| REPLY_LLM_API_KEY and REPLY_LLM_CHAT_MODEL | Final reply model. |
| ENABLE_QUEUE and REDIS_URL | Optional BullMQ backend; workers remain in process. |
| QDRANT_URL and QDRANT_COLLECTION | Optional retrieval. |
| ENABLE_VOICE and TTS variables | Optional voice delivery. |
| METRICS_AUTH_TOKEN | Required token for x-yuno-metrics-token. |

## QQ favorite memes

Use MEME_PROVIDER=onebot-favorites, MEME_FAVORITES_COUNT, and MEME_FAVORITES_SYNC_TTL_MS. Sync uses fetch_custom_face through the Koishi Protocol Adapter.

Removed variables: YUNO_ROLE, NAPCAT_API, NAPCAT_TOKEN, ONEBOT_WEBHOOK_SECRET, WEBHOOK_BODY_LIMIT, YUNO_API_URL, and YUNO_API_SECRET.