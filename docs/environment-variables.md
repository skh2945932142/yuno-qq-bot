# Yuno 环境变量说明

本文档以 `src/config.js` 和直接读取 `process.env` 的运行时代码为准。Zeabur 服务变量应保持最小化：有代码默认值的配置通常不需要重复写入，只有需要覆盖默认行为时才添加。

## 当前生产环境保留项

以下变量在 `yuno-qq-bot` 的 Zeabur 服务中有明确运行时用途。

| 分类 | 变量 | 用途 |
|---|---|---|
| 运行时 | `NODE_ENV`, `PORT` | 生产模式、安全策略和 HTTP 监听端口 |
| MongoDB | `MONGODB_URI` | 会话、关系、状态、记忆和任务持久化 |
| 上游模型 | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LLM_CHAT_MODEL` | 触发分析、摘要和其他上游模型任务 |
| 最终回复模型 | `REPLY_LLM_API_KEY`, `REPLY_LLM_BASE_URL`, `REPLY_LLM_CHAT_MODEL` | 生成最终发给 QQ 用户的回复 |
| 回复容错 | `REPLY_LLM_FALLBACK_API_KEY`, `REPLY_LLM_FALLBACK_BASE_URL`, `REPLY_LLM_FALLBACK_CHAT_MODEL` | 主回复模型 429、超时或 5xx 时使用的独立备用 provider |
| Gemini 回复控制 | `REPLY_LLM_REASONING_EFFORT`, `REPLY_LLM_KNOWLEDGE_REASONING_EFFORT`, `REPLY_LLM_STRUCTURED_OUTPUT` | Gemini 推理强度和结构化输出 |
| Embedding | `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL` | Qdrant 知识和长期记忆向量化 |
| Qdrant | `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION` | 知识库、长期记忆和表情包语义检索 |
| NapCat | `NAPCAT_API`, `NAPCAT_TOKEN` | 发送文字、语音、图片和读取 QQ 收藏表情 |
| 接口安全 | `ONEBOT_WEBHOOK_SECRET` | 保护 `/onebot` 和 `/api/yuno/conversation` |
| QQ 身份 | `ADMIN_QQ`, `SELF_QQ`, `TARGET_GROUP_ID` | 管理员权限、机器人身份兜底和定时群任务 |
| TTS | `ENABLE_VOICE`, `FFMPEG_PATH`, `TTS_PROVIDER`, `TTS_API_KEY`, `TTS_BASE_URL`, `TTS_MODEL`, `TTS_VOICE_DESIGN`, `VOICE_SAMPLE_RATE`, `VOICE_BITRATE` | MiMo 音频生成、转码和 Silk 编码 |
| 表情包 | `MEME_ENABLED`, `MEME_PROVIDER`, `MEME_ENABLED_GROUPS`, `MEME_AUTO_SEND`, `MEME_AUTO_SEND_MODE`, `MEME_AUTO_SEND_PROBABILITY`, `MEME_AUTO_SEND_MIN_SCORE`, `MEME_AUTO_SEND_COOLDOWN_MS`, `MEME_AUTO_SEND_MAX_PER_HOUR`, `MEME_NAPCAT_FAVORITES_COUNT`, `MEME_NAPCAT_FAVORITES_SYNC_TTL_MS` | QQ 收藏表情同步、候选筛选和自动发送策略 |
| 网络 | `REQUEST_TIMEOUT_MS` | 模型、Qdrant、NapCat 和 TTS 请求超时 |

当前生产配置没有单独设置 `TTS_SPEED`、`VOICE_REPLY_MODE`、`VOICE_REPLY_COOLDOWN_MS` 和 `VOICE_REPLY_MAX_CHARS`，因此分别使用代码默认值 `1.15`、`auto`、`90000` 和 `90`。

## 模型变量优先级

上游模型支持多组兼容变量，但同一部署只需选一组：

```text
LLM_API_KEY -> OPENAI_API_KEY -> SILICONFLOW_API_KEY -> GEMINI_API_KEY
LLM_BASE_URL -> OPENAI_BASE_URL -> provider default
LLM_CHAT_MODEL -> provider default
```

当前 Zeabur 部署使用 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `LLM_CHAT_MODEL`。因此不需要再重复配置 `LLM_API_KEY` 或 `LLM_BASE_URL`。

最终回复使用独立的 `REPLY_LLM_*`。即使当前上游和最终回复使用同一把 Google AI Studio key，也保留两组变量，以免未来调整上游模型时意外改变最终回复模型。

生产环境使用 `gemini-3.5-flash` 作为主回复模型，并使用 Google AI Studio 的 `gemini-3.1-flash-lite` 作为备用模型。主模型返回 429、超时或 5xx 时，工作流会把同一份会话历史、系统提示、用户消息和生成约束交给备用模型继续处理，不会先向用户发送中间错误提示；断路器按 provider 与模型隔离。

Embedding 使用独立的 `EMBEDDING_*`，不会依赖当前 Gemini 回复接口。

## 条件变量

这些变量被代码支持，但只有启用对应功能或覆盖默认值时才需要配置：

| 功能 | 变量 |
|---|---|
| 日常情绪 | `BOT_EXPERIENCE_MODE`, `BOT_DAILY_MOOD_ENABLED`, `BOT_DAILY_MOOD_SEED`, `BOT_DAILY_MOOD_TIMEZONE`, `BOT_DAILY_MOOD_OVERRIDE` |
| 回复长度 | `GROUP_CHAT_MAX_TOKENS`, `PRIVATE_CHAT_MAX_TOKENS`, `KNOWLEDGE_REPLY_MAX_TOKENS`, `GROUP_REPLY_LENGTH_TIER`, `PRIVATE_REPLY_LENGTH_TIER` |
| 对话自然度 | `CHAT_FOLLOWUP_RATE_PRIVATE`, `CHAT_FOLLOWUP_RATE_GROUP`, `CHAT_STYLE_REPEAT_GUARD`, `CHAT_ELLIPSIS_LIMIT` |
| 模型容错 | `REPLY_LLM_FALLBACK_CHAT_MODEL`, `MODEL_FALLBACK_CHAT_MODEL`, `REPLY_HARD_TIMEOUT_MS`, `REPLY_TIME_BUDGET_MS`, `MODEL_CIRCUIT_FAILURE_THRESHOLD`, `MODEL_CIRCUIT_OPEN_MS`, `RETRY_ATTEMPTS`, `RETRY_DELAY_MS` |
| 语音策略 | `TTS_SPEED`, `TTS_VOICE`, `YUNO_VOICE_URI`, `VOICE_REPLY_MODE`, `VOICE_REPLY_COOLDOWN_MS`, `VOICE_REPLY_MAX_CHARS`, `VOICE_REPLY_ON_USER_RECORD` |
| 检索调优 | `QDRANT_TOP_K`, `QDRANT_MIN_SCORE`, `QDRANT_CHAR_LIMIT`, `KNOWLEDGE_QUERY_CACHE_TTL_MS` |
| 记忆 | `MEMORY_EXTRACTION_ENABLED`, `MEMORY_SUMMARY_MODEL`, `SPECIAL_USERS_JSON` |
| 表情包扩展 | `MEME_AUTO_COLLECT`, `MEME_IMPORT_DIR`, `MEME_OPT_OUT_USERS`, `MEME_VISION_ENABLED`, `MEME_STORAGE_DIR`, `MEME_REQUIRE_ADMIN_FOR_AUTO_MODE` |
| 外部能力 | `VISION_API_KEY`, `VISION_BASE_URL`, `VISION_MODEL`, `OCR_API_KEY`, `OCR_BASE_URL`, `SEARCH_API_KEY`, `SEARCH_BASE_URL`, `EXTERNAL_TOOL_TIMEOUT_MS` |
| 队列 | `ENABLE_QUEUE`, `REDIS_URL`, `REPLY_QUEUE_NAME`, `PERSIST_QUEUE_NAME`, `QUEUE_RETRY_ATTEMPTS`, `QUEUE_BACKOFF_MS`, `QUEUE_CONCURRENCY_DEFAULT`, `QUEUE_CONCURRENCY_REPLY`, `QUEUE_CONCURRENCY_PERSIST` |
| 自动化 | `AUTOMATION_TASK_CONCURRENCY`, `MAX_ACTIVE_REMINDERS_PER_USER`, `MAX_ACTIVE_SUBSCRIPTIONS_PER_USER`, `GROUP_EVENT_RETENTION_COUNT` |
| 观测 | `ENABLE_METRICS`, `METRICS_PATH`, `METRICS_AUTH_TOKEN`, `LOG_LEVEL`, `TRACE_SAMPLE_RATE`, `OTLP_ENDPOINT` |
| Webhook | `WEBHOOK_BODY_LIMIT` |
| 策略覆盖 | `TOOL_CONFIG_JSON`, `TRIGGER_POLICY_JSON` |

`TTS_VOICE` 和旧别名 `YUNO_VOICE_URI` 只用于需要预设 voice ID 的模型。当前 `mimo-v2.5-tts-voicedesign` 请求只发送 `TTS_VOICE_DESIGN`，不使用预设 voice。

## 已从 Zeabur 删除的变量

以下可写变量不被 `yuno-qq-bot` 代码读取，也没有被其他变量通过 `${...}` 引用：

```text
ASTRBOT_API_KEY
ASTRBOT_BASE_URL
ASTRBOT_ENABLED
ASTRBOT_HOST
ASTRBOT_WEB_URL
ENABLE_KNOWLEDGE_BASE
MONGODB_HOST
NAPCAT_SUR_HOST
PASSWORD
QDRANT_HOST
YUNO_INDEPENDENT_MODE
YUNO_MONGODB_HOST
YUNO_QDRANT_HOST
```

另外删除了当前 voice-design 模型不会使用的 `TTS_VOICE`。如果以后改用预设音色 TTS 模型，再按模型要求重新添加即可。

`ENABLE_KNOWLEDGE_BASE` 不控制检索。检索是否启用由 `QDRANT_URL` 和 `QDRANT_COLLECTION` 决定，并要求知识库已经执行过 `npm run kb:sync`。

## Zeabur 只读变量

Zeabur 会根据绑定服务自动注入一些只读变量，例如：

```text
ASTRBOT_HOST
MONGO_CONNECTION_STRING
MONGO_HOST
MONGO_PASSWORD
MONGO_PORT
MONGO_URI
MONGO_USERNAME
MONGODB_HOST
NAPCAT_SUR_HOST
QDRANT__SERVICE__API_KEY
QDRANT_OMISTE_HOST
```

这些变量不属于应用配置清理范围。即使 Node 代码没有直接读取，也不要尝试删除；应用只需要通过明确的 `MONGODB_URI`、`NAPCAT_API` 和 `QDRANT_URL` 使用对应服务。

## 维护规则

1. 新增环境变量时，先在 `src/config.js` 集中解析并设置默认值。
2. 同一能力只保留一个明确的生产配置入口，兼容别名只用于迁移。
3. 不把密钥、令牌或包含凭据的 URI 写入文档和 Git。
4. 删除 Zeabur 变量前，同时检查代码读取、`${...}` 插值和平台只读变量。
5. 修改生产变量后，至少验证 `/health`、`/ready`、一次 capture 对话和相关下游服务状态。
