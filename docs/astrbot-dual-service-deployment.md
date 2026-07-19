# AstrBot + Yuno 双服务部署指南

## 架构说明

```
NapCat → AstrBot (接收 OneBot 事件) → HTTP 调用 → yuno-qq-bot (Yuno Core API)
```

## 服务职责

- **NapCat**: QQ 协议端，接收 QQ 消息并通过 OneBot 协议上报
- **AstrBot**: 接收 OneBot 事件，处理插件路由，调用 yuno-qq-bot API
- **yuno-qq-bot**: 提供 Yuno 人格核心 API，处理消息分析、记忆、情绪、知识检索等

## 步骤 1：配置 NapCat

NapCat 只连接到 AstrBot，不直接连接 yuno-qq-bot。

### WebUI 配置

1. 启用 **HTTP 服务端（反向 HTTP / HTTP Post）**
2. 关闭 **HTTP 客户端**
3. 关闭 **WebSocket 客户端**
4. 配置上报地址：
   - Zeabur 内部服务：`http://astrbot:6199/onebot`（或 AstrBot 监听的端口）
   - 外部访问：`https://你的astrbot域名/onebot`

### onebot11.json 配置示例

```json
{
  "http": {
    "enable": true,
    "host": "0.0.0.0",
    "port": 3001,
    "enablePost": true,
    "postUrls": [
      "http://astrbot:6199/onebot"
    ]
  },
  "ws": {
    "enable": false
  },
  "reverseWs": {
    "enable": false
  }
}
```

## 步骤 2：配置 yuno-qq-bot

yuno-qq-bot 提供 API 服务，不直接接收 OneBot 事件。

### Zeabur 环境变量

在 yuno-qq-bot 服务的 Variables 中配置：

```
MONGODB_URI=mongodb://...
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.minimaxi.com/v1
LLM_CHAT_MODEL=MiniMax-M2.7
NAPCAT_API=http://napcat:3001
NAPCAT_TOKEN=你的token
SELF_QQ=3847566155
TARGET_GROUP_ID=953748387
ADMIN_QQ=2945932142
PORT=3000
NODE_ENV=development

# API 安全密钥（可选，推荐配置）
ONEBOT_WEBHOOK_SECRET=yuno-api-secret-2024

# 其他可选配置
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=qq_bot_knowledge
ENABLE_VOICE=true
TTS_PROVIDER=mimo
TTS_API_KEY=sk-...
TTS_MODEL=mimo-v2.5-tts-voicedesign
TTS_VOICE_DESIGN=十八岁左右的年轻女性声线，清亮、干净、略偏高但不尖，带一点紧张感与敏锐感；咬字清晰、气息稳定，避免气声、耳语、沙哑和明显呼吸噪声。语速自然，节奏利落，短句停顿干净；语气专注、果断，偶尔带一点轻微占有欲和俏皮，但不慵懒、不甜腻、不夹、不夸张动漫腔。面对在意的人时稍微柔和，但保持清醒和利落。
TTS_SPEED=1.15
```

### API 端点

yuno-qq-bot 提供以下端点：

- `POST /api/yuno/conversation` - Yuno 对话 API（供 AstrBot 调用）
- `POST /onebot` - OneBot webhook（保留，当前不使用）
- `GET /health` - 健康检查
- `GET /ready` - 就绪检查
- `GET /metrics` - 监控指标

## 步骤 3：在 AstrBot 中安装 Yuno 插件

### 方法 A：通过 Git 仓库安装（推荐）

1. 将 `src/astrbot-yuno-http-plugin.js` 推送到 GitHub
2. 在 AstrBot 的插件管理中添加 Git 插件：
   ```
   https://github.com/skh2945932142/yuno-qq-bot.git
   ```
3. 插件入口文件：`src/astrbot-yuno-http-plugin.js`

### 方法 B：手动复制文件

1. 将 `src/astrbot-yuno-http-plugin.js` 复制到 AstrBot 的插件目录
2. 确保 AstrBot 安装了 `axios` 依赖：
   ```bash
   npm install axios
   ```

### AstrBot 环境变量配置

在 AstrBot 服务的 Variables 中添加：

```
YUNO_API_URL=http://yuno-qq-bot:3000
YUNO_API_SECRET=yuno-api-secret-2024
```

### AstrBot 插件配置

在 AstrBot 的插件配置文件中（通常是 `data/plugins/config.json`）：

```json
{
  "yuno-http-entry": {
    "enable": true,
    "priority": 100,
    "yunoApiUrl": "http://yuno-qq-bot:3000",
    "yunoApiSecret": "yuno-api-secret-2024",
    "requestTimeout": 30000
  }
}
```

## 步骤 4：禁用 AstrBot 的 OneBot 平台（如果配置了）

如果 AstrBot 配置了 `platform_aiocqhttp_yuno` 导致端口冲突，需要禁用或删除这个平台配置。

### 在 AstrBot 配置文件中

找到 `data/config.json` 或类似文件，修改：

```json
{
  "platform": {
    "aiocqhttp_yuno": {
      "enable": false
    }
  }
}
```

或者完全删除这个平台配置。

## 步骤 5：重启服务

按以下顺序重启：

1. 重启 yuno-qq-bot
2. 重启 AstrBot
3. 重启 NapCat（如果修改了配置）

## 验证部署

### 1. 检查 yuno-qq-bot 健康状态

```bash
curl http://yuno-qq-bot:3000/health
# 应该返回: Yuno online
```

### 2. 检查 AstrBot 日志

启动 AstrBot 后，应该看到：

```
[Yuno HTTP Plugin] 已加载，API 地址: http://yuno-qq-bot:3000
[Yuno HTTP Plugin] 健康检查成功: Yuno online
```

### 3. 发送测试消息

在 QQ 中向 bot 发送消息，观察：

1. NapCat 日志：确认消息已上报到 AstrBot
2. AstrBot 日志：确认调用了 yuno API
3. yuno-qq-bot 日志：确认处理了消息
4. QQ 中收到 bot 的回复

## 故障排查

### 问题 1：401 Unauthorized

**原因**: API 密钥不匹配

**解决**:
1. 检查 yuno-qq-bot 的 `ONEBOT_WEBHOOK_SECRET` 环境变量
2. 检查 AstrBot 的 `YUNO_API_SECRET` 环境变量
3. 确保两者一致

### 问题 2：Connection Refused

**原因**: yuno-qq-bot 服务未启动或地址错误

**解决**:
1. 检查 yuno-qq-bot 是否正常运行
2. 在 AstrBot 容器中测试连接：`curl http://yuno-qq-bot:3000/health`
3. 检查 Zeabur 内部网络连通性

### 问题 3：AstrBot 端口冲突

**原因**: AstrBot 的 OneBot 平台与其他服务冲突

**解决**:
1. 禁用 AstrBot 的 OneBot 平台配置
2. 确保 NapCat 只连接到 AstrBot，不连接 yuno-qq-bot

### 问题 4：NapCat WebSocket 超时

**原因**: NapCat 配置了反向 WebSocket 但无法连接

**解决**:
1. 在 NapCat 配置中禁用 `reverseWs`
2. 只保留 HTTP 服务端模式

## 架构优势

1. **职责清晰**: AstrBot 负责插件路由，yuno 负责人格核心
2. **独立扩展**: 两个服务可以独立升级和扩展
3. **故障隔离**: 一个服务故障不会影响另一个
4. **性能监控**: 可以分别监控每个服务的性能

## 注意事项

1. **不要让 NapCat 同时连接 AstrBot 和 yuno-qq-bot**，会导致消息重复处理
2. **API 密钥要保持一致**，否则会 401 错误
3. **建议在生产环境配置 API 密钥**，避免未授权访问
4. **yuno-qq-bot 的 `/onebot` 端点保留但不使用**，未来可以切换回直连模式
