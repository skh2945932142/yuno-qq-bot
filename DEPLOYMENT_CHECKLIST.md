# 双服务部署配置清单

## ✅ 已完成的工作

1. ✅ 创建了 `/api/yuno/conversation` API 端点
2. ✅ 创建了 `astrbot-yuno-http-plugin.js` AstrBot 插件
3. ✅ 添加了 CLAUDE.md 项目开发指南
4. ✅ 添加了详细的双服务部署文档
5. ✅ 提交了所有代码更改到 Git
6. ✅ 修改了本地 `.env` 文件，添加了 `ONEBOT_WEBHOOK_SECRET` 和 `NODE_ENV`

## 📋 你需要在 Zeabur 上完成的配置

### 步骤 1：推送代码到 GitHub

```bash
git push origin main
```

这会触发 Zeabur 自动部署 yuno-qq-bot 服务。

### 步骤 2：配置 yuno-qq-bot 服务环境变量

在 Zeabur 的 yuno-qq-bot 服务中，点击 **Variables** 标签，添加或确认以下变量：

```
ONEBOT_WEBHOOK_SECRET=yuno-api-secret-2024
NODE_ENV=development
```

其他环境变量保持不变。点击 **Redeploy** 重新部署。

### 步骤 3：配置 NapCat

在 NapCat WebUI 中：

1. **关闭** HTTP 客户端
2. **开启** HTTP 服务端（反向 HTTP / HTTP Post）
3. **关闭** WebSocket 客户端
4. **关闭** 反向 WebSocket

配置 HTTP 服务端：
- 上报地址：`http://astrbot:6199/onebot`（或 AstrBot 的实际端口）
- 不需要配置请求头（AstrBot 不需要验证）

保存并重启 NapCat。

### 步骤 4：在 AstrBot 中安装 Yuno 插件

#### 选项 A：通过文件上传（最简单）

1. 在本地找到 `src/astrbot-yuno-http-plugin.js` 文件
2. 登录 AstrBot WebUI
3. 进入插件管理 → 上传插件
4. 上传 `astrbot-yuno-http-plugin.js` 文件
5. 启用插件

#### 选项 B：通过 AstrBot Console（如果有终端访问）

1. 在 Zeabur AstrBot 服务中打开 Console
2. 下载插件文件：
```bash
cd /AstrBot/data/plugins
wget https://raw.githubusercontent.com/skh2945932142/yuno-qq-bot/main/src/astrbot-yuno-http-plugin.js
```
3. 重启 AstrBot

### 步骤 5：配置 AstrBot 环境变量

在 Zeabur 的 AstrBot 服务中，点击 **Variables** 标签，添加：

```
YUNO_API_URL=http://yuno-qq-bot:3000
YUNO_API_SECRET=yuno-api-secret-2024
```

点击 **Redeploy** 重新部署。

### 步骤 6：禁用 AstrBot 的 OneBot 平台（如果有配置）

如果 AstrBot 之前配置了 `platform_aiocqhttp_yuno` 导致端口冲突，需要禁用它：

1. 在 Zeabur AstrBot 服务的 Console 中
2. 编辑配置文件（通常是 `data/config.json`）
3. 找到 `platform` 部分，设置：
```json
{
  "platform": {
    "aiocqhttp_yuno": {
      "enable": false
    }
  }
}
```
4. 保存并重启 AstrBot

### 步骤 7：验证部署

1. **查看 yuno-qq-bot 日志**：
   - 应该看到服务启动成功
   - 端口 3000 正常监听

2. **查看 AstrBot 日志**：
   - 应该看到 `[Yuno HTTP Plugin] 已加载`
   - 应该看到 `[Yuno HTTP Plugin] 健康检查成功: Yuno online`

3. **发送测试消息**：
   - 在 QQ 中向 bot 发送消息
   - 观察 NapCat、AstrBot、yuno-qq-bot 的日志
   - 确认 bot 正常回复

## 🔍 故障排查

### 问题 1：NapCat 报 401 错误

**原因**：NapCat 连接的还是 yuno-qq-bot，而不是 AstrBot

**解决**：
- 检查 NapCat 的上报地址是否为 `http://astrbot:6199/onebot`
- 不是 `http://yuno-qq-bot:3000/onebot`

### 问题 2：AstrBot 端口冲突 [Errno 98]

**原因**：AstrBot 的 OneBot 平台还在运行

**解决**：
- 在 AstrBot 配置中禁用 `platform_aiocqhttp_yuno`
- 或者修改其端口号

### 问题 3：AstrBot 调用 yuno API 失败

**原因**：环境变量未配置或服务名错误

**解决**：
- 检查 AstrBot 的 `YUNO_API_URL` 是否为 `http://yuno-qq-bot:3000`
- 检查 `YUNO_API_SECRET` 是否与 yuno-qq-bot 的 `ONEBOT_WEBHOOK_SECRET` 一致
- 在 AstrBot Console 中测试连接：`curl http://yuno-qq-bot:3000/health`

### 问题 4：插件未加载

**原因**：插件文件未正确安装或格式错误

**解决**：
- 检查插件文件是否在 AstrBot 的插件目录
- 查看 AstrBot 日志中的插件加载错误
- 确保 AstrBot 安装了 `axios` 依赖

## 📚 相关文档

- `CLAUDE.md` - 项目开发指南
- `docs/astrbot-dual-service-deployment.md` - 详细部署文档
- `README.md` - 项目总体说明

## 🎯 当前架构

```
用户消息 (QQ)
    ↓
NapCat (QQ 协议转 OneBot)
    ↓ HTTP Post
AstrBot (插件路由、权限管理)
    ↓ HTTP API 调用
yuno-qq-bot (人格核心、记忆、情绪、知识检索)
    ↓ 返回回复
AstrBot
    ↓ 通过 NapCat
QQ 用户收到回复
```

## ⚡ 优势

1. **职责清晰**：AstrBot 处理插件，yuno 处理人格
2. **独立扩展**：两个服务可以独立升级
3. **故障隔离**：一个服务故障不影响另一个
4. **灵活切换**：保留了 `/onebot` 端点，可以随时切换回直连模式

## 📝 注意事项

1. **API 密钥要保持一致**：`YUNO_API_SECRET` 和 `ONEBOT_WEBHOOK_SECRET` 必须相同
2. **不要让 NapCat 同时连接两个服务**：只连接 AstrBot
3. **建议生产环境配置密钥**：避免未授权访问
4. **保留 `/onebot` 端点**：未来可以切换回直连模式
