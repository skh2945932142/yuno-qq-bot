# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个由乃人格驱动的 QQ Bot，基于 OneBot/NapCat 协议。当前架构已经收口成统一主线：所有事件进入后走同一份触发分析、记忆、情绪、RAG、工具路由和回复格式化流程。

**核心设计原则**：外部能力负责拿结果，最终怎么说都交给 Yuno Core。

## 常用命令

### 开发与测试
```bash
npm install                    # 安装依赖
npm start                      # 启动 bot
npm run dev                    # 开发模式（自动重启）
npm test                       # 运行主线测试
npm run eval                   # 运行轻量行为评估
npm run eval:report            # 生成体验评分卡到 reports/eval-experience.md
npm run eval:style             # 运行风格评估
npm run eval:style:report      # 生成风格评分卡到 reports/eval-reply-style.md
```

### 知识库与表情包
```bash
npm run kb:sync                # 同步 knowledge/ 目录到 Qdrant 向量库
npm run meme:import            # 导入表情包素材（从 MEME_IMPORT_DIR）
```

### 健康检查与监控
```bash
npm run doctor                 # 检查所有外部依赖是否可达（Mongo/NapCat/LLM/Qdrant/Redis/FFmpeg）
npm run smoke                  # 运行真实对话流程但不外发消息
npm run smoke:mock             # 运行轻量 smoke（不依赖外部服务）
npm run benchmark:reply        # 本地基准测试（输出 P50/P95 延迟）
```

### 安全检查
```bash
npm run security:audit         # 依赖安全审计（需配合 security/audit-allowlist.json）
npm run security:secrets       # 扫描代码中的敏感信息泄漏
```

### 自动化报告
```bash
npm run automation:ideas       # 生成体验改进创意报告
npm run automation:dev-health  # 生成开发健康报告
```

## 架构设计

### 统一消息处理主线

```
OneBot / NapCat
  └─ src/index.js
       └─ src/bootstrap-phase1.js
            └─ src/message-workflow.js (核心工作流)
                 ├─ src/message-analysis.js (触发分析)
                 ├─ src/task-router.js (任务路由)
                 ├─ src/emotion-engine.js (情绪引擎)
                 ├─ src/prompt-builder.js (提示词构建)
                 ├─ src/reply-length.js (回复长度策略)
                 ├─ src/query-tools.js (工具执行)
                 └─ src/yuno-formatter.js (由乃风格格式化)

AstrBot / 外部编排
  └─ src/yuno-core.js (对外稳定接口)
       └─ src/message-workflow.js
```

### 关键模块职责

- **src/yuno-core.js**: 对外稳定入口，AstrBot 或其他编排层通过此模块复用人格核心
- **src/message-workflow.js**: 统一工作流，包含 `shouldRespondToEvent`、`processIncomingMessage`、`processPersistJob` 三个核心函数
- **src/message-analysis.js**: 触发规则判定（快速路径 + 完整分析）
- **src/task-router.js**: 决定消息走 chat/tool/command 哪条路由
- **src/emotion-engine.js**: 根据关系、用户状态、群状态计算情绪和强度
- **src/prompt-builder.js**: 构建系统提示词，包含记忆、知识、人格策略
- **src/yuno-formatter.js**: 将工具结果转换为由乃视角的自然语言
- **src/tools/registry.js**: 工具注册中心
- **src/query-tools.js**: 工具执行器（registerQueryTools 注册所有工具）

### 数据流向

1. **触发判定**: `analyzeTriggerFast` (快速路径) 或 `analyzeTrigger` (完整分析)
2. **路由决策**: `planIncomingTask` 决定 tool/chat/command
3. **上下文加载**: `buildWorkflowContext` 加载关系、状态、记忆、群历史
4. **知识检索**: `retrieveKnowledge` (如果 `requiresRetrieval=true`)
5. **记忆检索**: `retrieveMemoryContext` (加载 eventMemories 和 memeMemories)
6. **情绪计算**: `resolveEmotion` 生成情绪结果
7. **提示词构建**: `buildReplyContext` 生成系统提示词
8. **模型生成**: `chat` 调用 LLM 生成回复
9. **格式化**: `shapeChatReplyText` + `enforceEmojiBudget` + `normalizeReplyFormatting`
10. **语音决策**: `resolveVoiceReplyDecision` 判断是否发送语音
11. **表情包决策**: `planContextualMemeReply` 判断是否跟发表情包
12. **状态持久化**: `persistReplyState` 更新关系、用户状态、会话、记忆

### 队列与持久化

- **BullMQ 双队列模式**（需要 `ENABLE_QUEUE=true` + Redis）:
  - `reply` 队列: 处理回复生成（`processReplyJob`）
  - `persist` 队列: 处理状态持久化（`processPersistJob`）
- **Inline 模式**（队列不可用时自动降级）:
  - 回复和持久化在同一个流程里同步完成

### 特殊用户策略

通过 `SPECIAL_USERS_JSON` 配置专属人格：
- `personaMode`: 人格模式（如 `exclusive_adoration`）
- `toneMode`: 语气模式（如 `flirtatious_favorite`）
- `affectionFloor`: 好感值下限
- `addressUserAs` / `addressBotAs`: 称呼绑定
- `knowledgeTags`: 专属知识标签
- `triggerKeywords`: 专属触发词
- `groupStyle` / `privateStyle`: 场景化风格

## 环境变量与配置

### 必填
- `MONGODB_URI`: MongoDB 连接字符串
- `LLM_API_KEY`: LLM API 密钥
- `LLM_CHAT_MODEL`: 聊天模型名称
- `NAPCAT_API`: NapCat API 地址

### 常用可选
- `LLM_BASE_URL`: LLM API 基础 URL（默认使用 OpenAI）
- `SELF_QQ`: Bot 自己的 QQ 号（用于识别 @ 和戳一戳）
- `TARGET_GROUP_ID`: 目标群组 ID
- `ADMIN_QQ`: 管理员 QQ 号

### 检索相关
- `QDRANT_URL`: Qdrant 向量数据库地址（完整 URL 包含 `http://` 或 `https://`）
- `QDRANT_COLLECTION`: 集合名称（默认 `qq_bot_knowledge`）
- `QDRANT_API_KEY`: Qdrant API 密钥（可选）
- `EMBEDDING_API_KEY`: Embedding 模型密钥
- `EMBEDDING_BASE_URL`: Embedding API 基础 URL
- `EMBEDDING_MODEL`: Embedding 模型名称（默认 `text-embedding-3-small`）

### 语音相关
- `ENABLE_VOICE`: 是否启用语音（默认 `false`）
- `TTS_PROVIDER`: TTS 提供商（`openai_compatible` 或 `mimo`）
- `TTS_API_KEY`: TTS API 密钥
- `TTS_BASE_URL`: TTS API 基础 URL
- `TTS_MODEL`: TTS 模型名称
- `YUNO_VOICE_URI`: 由乃语音 URI
- `VOICE_REPLY_MODE`: 语音回复模式（`off`/`model`/`auto`/`force`）
- `VOICE_REPLY_COOLDOWN_MS`: 语音回复冷却时间
- `VOICE_REPLY_MAX_CHARS`: 语音回复最大字符数
- `VOICE_REPLY_ON_USER_RECORD`: 用户发语音时是否优先语音回复
- `FFMPEG_PATH`: FFmpeg 可执行文件路径

### 队列相关
- `ENABLE_QUEUE`: 是否启用 BullMQ 队列（默认 `false`）
- `REDIS_URL`: Redis 连接字符串

### 表情包相关
- `MEME_ENABLED`: 是否启用表情包功能
- `MEME_AUTO_COLLECT`: 自动收集群图片
- `MEME_AUTO_SEND`: 自动发送表情包
- `MEME_AUTO_SEND_MODE`: 自动发送模式（`off`/`suggest`/`auto`）
- `MEME_PROVIDER`: 表情包提供商（`local` 或 `napcat-favorites`）
- `MEME_IMPORT_DIR`: 表情包导入目录（默认 `data/qq-favorite-memes`）
- `MEME_STORAGE_DIR`: 表情包存储目录
- `MEME_ENABLED_GROUPS`: 启用表情包的群组列表
- `MEME_OPT_OUT_USERS`: 退出表情包功能的用户列表

### 安全相关
- `ONEBOT_WEBHOOK_SECRET`: OneBot webhook 验证密钥（生产环境必填）
- `METRICS_AUTH_TOKEN`: 指标端点访问令牌

## 开发注意事项

### 文案风格规范
所有用户可见文案遵循 `docs/copy-style.md` 规范：
- 中文主句，保留必要技术名词
- 由乃视角，带观察感和偏爱感
- 避免系统公告腔、控制台面板腔
- 先人设化过渡，再给结果
- 群聊更短，私聊可以多一句安抚或解释

### 群聊触发规则
群聊默认保守模式，只有以下情况触发回复：
- 明确 `@bot`
- 命中触发关键词
- 显式 `/command` 命令
- QQ 戳一戳且目标是 bot 本体

私聊保持默认可回复模式。

### 知识库同步规则
- `npm run kb:sync` 会跳过 `knowledge/README.md`
- Markdown 文件头部的 `Tags:` 和 `Priority:` 会继承到子章节
- 占位片段不会入库

### 表情包功能
默认关闭自动发图，推荐先用 `MEME_AUTO_SEND_MODE=suggest` 观察日志，确认匹配质量后再开启 `MEME_AUTO_SEND=true`。

### 语音功能
只有在显式设置 `ENABLE_VOICE=true` 后才需要 `FFMPEG_PATH`。文本链路建议先跑通再开启语音。

### 检索功能
检索不是默认开启的。必须满足以下条件：
1. 配置 `QDRANT_URL` 和 `QDRANT_COLLECTION`
2. 执行 `npm run kb:sync` 同步知识库

### 安全检查
依赖告警必须出现在 `security/audit-allowlist.json` 且未过期，否则 CI 会失败。

### 测试策略
- `npm test`: 主线和阶段性回归测试
- `npm run eval`: 轻量行为评估
- `npm run smoke`: 真实对话流程但不外发消息（适合验证完整链路）
- `npm run smoke:mock`: 轻量 smoke（适合 CI 快速兜底）

### 部署模式
三种部署模式详见 README.md：
1. 服务器宿主机直接运行（使用 `env.server.example`）
2. Docker / Compose 同网段运行（使用 `env.docker.example`）
3. Zeabur 模板部署（直接修改服务 Variables 页面）

### Webhook 安全
如果 `/onebot` 暴露到公网，必须配置 `ONEBOT_WEBHOOK_SECRET`。生产模式下未配置会直接拒绝请求。

## 扩展点

### 新增工具
1. 在 `src/tool-config.js` 添加工具定义
2. 在 `src/query-tools.js` 补对应执行器
3. 测试工具执行流程

### 新增知识
在 `knowledge/` 目录下添加 Markdown 文件，执行 `npm run kb:sync` 同步到 Qdrant。

### 队列拆分
如果要把 reply/persist 队列拆到独立 worker，只需要在现有队列接口外再起单独进程，无需改动 API。

## AstrBot 接入

### 双服务架构（推荐）

```
NapCat → AstrBot → HTTP API → yuno-qq-bot
```

职责分工：
- **AstrBot**: 接收 OneBot 事件，处理插件路由
- **yuno-qq-bot**: 提供 API 服务，处理人格核心逻辑

关键文件：
- `src/astrbot-yuno-http-plugin.js`: AstrBot HTTP 调用插件
- `POST /api/yuno/conversation`: Yuno 对话 API 端点

详细配置见 `docs/astrbot-dual-service-deployment.md`

### 同进程架构（备选）

- `src/yuno-core.js`: 对外稳定入口
- `src/astrbot-yuno-plugin.js`: 最小 AstrBot 风格包装层
- `src/astrbot-plugin-router.js`: 同进程插件路由
- `deploy/astrbot/`: 部署模板和接入说明

推荐边界：AstrBot 负责插件、权限、编排、外部能力；Yuno Core 负责触发分析、记忆、情绪、检索和最终回复风格。
