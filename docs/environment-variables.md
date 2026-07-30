# Environment Variables

## Koishi and OneBot

| Variable | Purpose |
|---|---|
| SELF_QQ | QQ account selected for delivery and protocol actions. |
| ADMIN_QQ | User allowed to run /koishi management commands. |
| ONEBOT_TRANSPORT | Final runtime transport; use ws for LLBot. |
| ONEBOT_ENDPOINT | LLBot private OneBot WebSocket URL. |
| ONEBOT_TOKEN | LLBot OneBot WebSocket Bearer token. |
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

## Humanized reply pacing

| Variable | Purpose |
|---|---|
| REPLY_CADENCE_ENABLED | Master switch for the humanized pre-reply delay and typing pacing. |
| REPLY_CADENCE_READ_MS_PER_CHAR, REPLY_CADENCE_READ_MAX_MS | Simulated reading time per inbound character and its ceiling. |
| REPLY_CADENCE_MIN_PRE_DELAY_MS, REPLY_CADENCE_MAX_PRE_DELAY_MS | Clamp for the delay before the first bubble is sent. |
| REPLY_CADENCE_TYPING_MS_PER_CHAR, REPLY_CADENCE_TYPING_MAX_MS | Per-character typing time between segments and its ceiling. |
| REPLY_CADENCE_JITTER_RATIO | Random jitter applied to every cadence delay, 0 disables jitter. |
| TYPING_INDICATOR_ENABLED | Sends the OneBot set_input_status action during private-chat pre-delay; silently disabled when unsupported. |
| REPLY_SEGMENT_TRIM_TRAILING_PERIOD | Drops the trailing period on short bubbles so segments read like chat messages. |
| GROUP_REPLY_QUOTE_MODE | auto quotes only when the reply would otherwise be ambiguous; always and never force the behavior. |
| GROUP_MESSAGE_AGGREGATION_ENABLED, GROUP_MESSAGE_AGGREGATION_WINDOW_MS, GROUP_MESSAGE_AGGREGATION_MAX_WINDOW_MS | Merges rapid explicitly triggered group messages into one reply. |

## Participation policy

| Variable | Purpose |
|---|---|
| PARTICIPATION_SKIP_PROBABILITY | Chance to stay silent on weak keyword-only group hits. |
| PARTICIPATION_REACTION_PROBABILITY | Chance to answer a low-information message with an emoji reaction instead of text. |
| PARTICIPATION_MAX_CONSECUTIVE_REPLIES | Consecutive replies to the same user before downgrading to reaction or silence. |
| AMBIENT_JOIN_ENABLED, AMBIENT_JOIN_PROBABILITY | Low-frequency unprompted joins in the target group. Disabled by default. |
| AMBIENT_JOIN_COOLDOWN_MS, AMBIENT_JOIN_MAX_PER_DAY | Cooldown and daily cap for ambient joins (only used when AMBIENT_JOIN_ENABLED=true). |
| PROACTIVE_MESSAGES_ENABLED | Scheduled proactive group messages at 07:00 and 23:00. Disabled by default; the 21:00 daily digest is unaffected. |

Explicit summons (private chat, @, commands, poke) are never dropped by the participation policy. Consecutive-reply counters and ambient-join cooldowns live in process memory only, so they reset on restart and are not stored in MongoDB.

With AMBIENT_JOIN_ENABLED=false and PROACTIVE_MESSAGES_ENABLED=false the bot never speaks first: it only answers explicit summons and tool or automation deliveries.

## Meme cache

Use MEME_PROVIDER=local-cache to keep existing stored assets and collect safe incoming images. LLBot migration does not use fetch_custom_face.

Removed variables: ONEBOT_SECRET, YUNO_ROLE, NAPCAT_API, NAPCAT_TOKEN, ONEBOT_WEBHOOK_SECRET, WEBHOOK_BODY_LIMIT, YUNO_API_URL, and YUNO_API_SECRET.
