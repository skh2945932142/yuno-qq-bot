# Yuno QQ Bot

由乃人格驱动的 QQ Bot。当前仓库已经收口成一条统一主线：OneBot/NapCat 事件进入后，走同一份触发分析、记忆、情绪、RAG、工具路由和回复格式化流程；AstrBot 或其他外部编排层也通过同一个 `Yuno Core` 复用这套人格核心。

## 这是什么

这个项目现在负责三件事：

- 在 QQ 群聊和私聊里接收并归一化消息事件
- 基于触发规则、记忆、情绪、知识库和工具结果生成由乃风格回复
- 为 AstrBot、自动化任务、群运营能力和表情包能力提供统一的人格化出口

主设计原则只有一条：

- 外部能力负责拿结果，最终怎么说都交给 Yuno Core

## 当前运行架构

```text
OneBot / NapCat
  └─ src/index.js
       └─ src/bootstrap-phase1.js
            └─ src/message-workflow.js
                 ├─ src/message-analysis.js
                 ├─ src/task-router.js
                 ├─ src/emotion-engine.js
                 ├─ src/prompt-builder.js
                 ├─ src/reply-length.js
                 ├─ src/query-tools.js
                 └─ src/yuno-formatter.js

AstrBot / 外部编排
  └─ src/yuno-core.js
       └─ src/message-workflow.js
```

## 现在具备的能力

- OneBot 群聊 / 私聊统一入站
- 显式触发群聊回复：`@bot`、关键词、`/command`、戳一戳 bot 本体
- 短期记忆、长期画像、关系状态、情绪状态
- Qdrant 检索增强生成（RAG）
- BullMQ / inline 双模式队列执行
- 群报告、活跃榜、关键词监控、提醒、订阅
- AstrBot 同进程接入接口
- 表情包一期：素材收集、检索、单条仿聊天截图生成
- `/health`、`/ready`、`/metrics`、`doctor`、`smoke`

## 快速运行

```bash
npm install
npm run doctor
npm run smoke
npm start
```

如果你是第一次启用知识库，还要再跑一次：

```bash
npm run kb:sync
```

## 关键环境变量

必填：

- `MONGODB_URI`
- `LLM_API_KEY` 或 `OPENAI_API_KEY`
- `LLM_CHAT_MODEL`
- `NAPCAT_API`

常用可选项：

- `LLM_BASE_URL`
- `EMBEDDING_MODEL`
- `TARGET_GROUP_ID`
- `ADMIN_QQ`
- `SELF_QQ`
- `REQUEST_TIMEOUT_MS`
- `RETRY_ATTEMPTS`
- `RETRY_DELAY_MS`
- `MODEL_CIRCUIT_FAILURE_THRESHOLD`
- `MODEL_CIRCUIT_OPEN_MS`
- `CHAT_FOLLOWUP_RATE_PRIVATE`
- `CHAT_FOLLOWUP_RATE_GROUP`
- `CHAT_STYLE_REPEAT_GUARD`
- `CHAT_ELLIPSIS_LIMIT`

语音相关：

- `ENABLE_VOICE`
- `TTS_API_KEY`
- `TTS_BASE_URL`
- `TTS_MODEL`
- `YUNO_VOICE_URI`
- `FFMPEG_PATH`

检索相关：

- `QDRANT_URL`
- `QDRANT_API_KEY`
- `QDRANT_COLLECTION`
- `QDRANT_TOP_K`
- `QDRANT_MIN_SCORE`
- `QDRANT_CHAR_LIMIT`

队列相关：

- `ENABLE_QUEUE`
- `REDIS_URL`
- `REPLY_QUEUE_NAME`
- `PERSIST_QUEUE_NAME`
- `QUEUE_RETRY_ATTEMPTS`
- `QUEUE_BACKOFF_MS`
- `QUEUE_CONCURRENCY_DEFAULT`
- `QUEUE_CONCURRENCY_REPLY`
- `QUEUE_CONCURRENCY_PERSIST`

观测相关：

- `ENABLE_METRICS`
- `METRICS_PATH`
- `OTLP_ENDPOINT`
- `LOG_LEVEL`
- `TRACE_SAMPLE_RATE`

个性化与功能开关：

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

## 部署模式

### 1. 服务器宿主机直接运行

如果你是在 Linux 服务器上直接跑 `node src/index.js` 或 `npm start`，从 [env.server.example](./env.server.example) 开始。

这个模式下要特别注意：

- `MONGODB_URI` 必须填服务器能直接访问到的地址，不要保留 Docker 内部服务名
- 文本链路建议先跑通，语音默认保持关闭；只有在显式设置 `ENABLE_VOICE=true` 后，`FFMPEG_PATH` 才需要指向真实存在的 ffmpeg，可执行文件通常是 `/usr/bin/ffmpeg`
- `SELF_QQ` 最好显式填写 bot 自己的 QQ 号，避免上游 notice 缺字段时无法正确识别 @ 与 poke 目标
- 检索不是默认开启的；只有在填好 `QDRANT_URL`、`QDRANT_COLLECTION` 并执行 `npm run kb:sync` 之后，RAG 才会真正参与回复

### 2. Docker / Compose 同网段运行

如果 Node、MongoDB、NapCat、Qdrant 都在同一个容器网络里，从 [env.docker.example](./env.docker.example) 开始。

这个模式下可以使用 `mongo`、`qdrant` 之类的服务名，但前提是 Node 进程真的运行在同一张容器网络里。

## Special Users 配置示例

`SPECIAL_USERS_JSON` 用来按 `userId` 绑定专属人格策略。示例：

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
    "groupStyle": "群聊里更克制地护短、偏爱和吃醋，不刷屏。",
    "privateStyle": "私聊里更黏人、更暧昧，喜欢引用记忆和约定，但不进入现实威胁。"
  }
]
```

## 常见检查命令

```bash
npm test
npm run eval
npm run kb:sync
npm run doctor
npm run smoke
```

用途分别是：

- `npm test`：跑当前主线和阶段性回归测试
- `npm run eval`：跑轻量行为评估
- `npm run kb:sync`：把 `knowledge/` 里的 Markdown 切块、向量化并同步到 Qdrant
- `npm run doctor`：检查 Mongo、NapCat、LLM、Qdrant、Redis、FFmpeg 是否真的可达；语音关闭和未配置检索显示 `skip` 属于正常状态
- `npm run smoke`：走真实 `runYunoConversation(...)` 主链，但不外发 QQ、不写会话状态

## AstrBot 接入

- `src/yuno-core.js` 是对外稳定入口
- `src/astrbot-yuno-plugin.js` 是最小 AstrBot 风格包装层
- `src/astrbot-plugin-router.js` 负责同进程插件路由
- `deploy/astrbot/` 只放部署模板和接入说明，不 vendoring AstrBot 上游源码

推荐边界：

- AstrBot 负责插件、权限、编排、外部能力
- Yuno Core 负责触发分析、记忆、情绪、检索、专属用户策略和最终回复风格

## 群聊触发规则

群聊默认是保守模式，只有这些情况才会触发回复：

- 明确 `@bot`
- 命中触发关键词
- 显式 `/command` 命令
- QQ 戳一戳，且目标确实是 bot 本体

私聊保持默认可回复模式，除非你自己通过策略配置覆盖。

## 表情包一期

当前表情包能力拆成了几层：

- 收集：群图片 / 素材入库
- 检索：按标签、关键词、人物和情绪召回
- 生成：单条消息仿聊天截图 SVG
- 决策：判断是收藏、发库存、现做一张，还是这次不发图

默认情况下，自动发图是关闭的。需要显式配置 `MEME_AUTO_SEND=true`，并配好群白名单或 opt-out 规则后再启用。

## 用户文案规范

所有用户可见文案现在都按同一套规则收口，详细约定见 [docs/copy-style.md](./docs/copy-style.md)。

当前默认风格：

- 中文主句，必要技术名词保留英文
- 由乃视角，轻微观察感和偏爱感
- 不走控制台面板腔，不用冷冰冰的系统公告口吻
- 结果要清楚，但不要把气氛全打碎

## 运行与运维说明

- 检索是正式功能，不是占位边界。只有在 `QDRANT_URL` 和 `QDRANT_COLLECTION` 都配置后，并且执行过 `npm run kb:sync`，它才会真正启用。
- 如果 `ENABLE_QUEUE=false`，或者 BullMQ / Redis 不可用，系统会退回 inline 模式，但队列接口不变。
- `/ready` 用于检查数据库和队列就绪情况，`/metrics` 暴露 Prometheus 风格指标。
- 当前唯一活跃运行主线是 `src/message-workflow.js`，旧版群聊工作流已经移除。

## 后续扩展点

- 在 `src/tool-config.js` 里新增工具定义
- 在 `src/query-tools.js` 里补对应执行器
- 在 `knowledge/` 里继续补设定、FAQ、世界观或业务文档
- 如果要把 reply/persist 队列拆到独立 worker，只需要在现有队列接口外再起单独进程
