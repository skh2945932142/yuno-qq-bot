# 🚀 AstrBot + Yuno 双服务快速安装指南

## 📦 已完成的准备工作

✅ yuno-qq-bot API 端点已创建  
✅ AstrBot 插件已开发完成  
✅ 完整文档已准备就绪  
✅ 代码已提交到本地 Git（2 个 commits）

---

## 🎯 现在你需要做的 3 件事

### 1️⃣ 推送代码到 GitHub（网络恢复后）

当你的网络能访问 GitHub 时，运行：

```bash
cd D:\code\QaQ_bot\yuno-qq-bot
git push origin main
```

如果一直无法连接 GitHub，可以：
- 使用代理或 VPN
- 或在其他网络环境下推送
- 或使用 GitHub Desktop 客户端

### 2️⃣ 在 Zeabur 安装 AstrBot 插件

**方式 A：通过 GitHub 安装（推荐，需要先完成步骤 1）**

1. 打开浏览器访问 https://zeabur.com
2. 进入你的 AstrBot 服务
3. 找到插件管理界面
4. 选择"从 GitHub 安装"
5. 输入：
   - 仓库地址：`https://github.com/skh2945932142/yuno-qq-bot`
   - 插件目录：`astrbot-plugin-yuno`
6. 点击安装

**方式 B：手动安装（如果 GitHub 方式不可用）**

1. 在 Zeabur AstrBot 服务中打开 **Console**
2. 运行以下命令：

```bash
# 进入插件目录
cd /AstrBot/data/plugins

# 创建插件目录
mkdir -p yuno_qq_bot

# 创建 metadata.yaml
cat > yuno_qq_bot/metadata.yaml << 'EOF'
name: yuno_qq_bot
version: 1.0.0
author: Yuno Bot Team
desc: Yuno 人格核心 HTTP 调用插件，通过 API 连接到 yuno-qq-bot 服务
repo: https://github.com/skh2945932142/yuno-qq-bot
EOF

# 创建 main.py（需要复制完整内容）
nano yuno_qq_bot/main.py
# 然后粘贴 astrbot-plugin-yuno/main.py 的内容
# 保存：Ctrl+O, Enter, Ctrl+X

# 创建 requirements.txt
echo "aiohttp>=3.8.0" > yuno_qq_bot/requirements.txt
```

### 3️⃣ 配置环境变量

在 Zeabur Web 界面配置以下服务：

#### yuno-qq-bot 服务

Variables 标签页，添加：
```
ONEBOT_WEBHOOK_SECRET=yuno-api-secret-2024
NODE_ENV=development
```

点击 **Redeploy**

#### AstrBot 服务

Variables 标签页，添加：
```
YUNO_API_URL=http://yuno-qq-bot:3000
YUNO_API_SECRET=yuno-api-secret-2024
```

点击 **Redeploy**

---

## 🔧 配置 NapCat

在 NapCat WebUI 中配置：

### 关闭这些功能：
- ❌ HTTP 客户端
- ❌ WebSocket 客户端
- ❌ 反向 WebSocket

### 开启并配置：
- ✅ **HTTP 服务端（反向 HTTP）**
  - 上报地址：`http://astrbot:6199/onebot`
  - 不需要配置请求头

### 保存配置并重启 NapCat

---

## ✅ 验证部署

### 1. 检查服务日志

在 Zeabur 各服务的 **Logs** 标签查看：

**yuno-qq-bot:**
```
✓ Yuno online
✓ Listening on port 3000
```

**AstrBot:**
```
✓ [Yuno HTTP Plugin] 已加载，API 地址: http://yuno-qq-bot:3000
✓ [Yuno HTTP Plugin] 健康检查成功: Yuno online
```

**NapCat:**
```
✓ 连接到 AstrBot 成功
✓ 不应该再有 401 或连接错误
```

### 2. 测试消息

在 QQ 中向 bot 发送消息，观察：
1. NapCat 上报消息到 AstrBot ✓
2. AstrBot 调用 yuno-qq-bot API ✓
3. yuno-qq-bot 处理消息并返回回复 ✓
4. AstrBot 通过 NapCat 发送回复到 QQ ✓
5. 你在 QQ 中收到 bot 的回复 ✓

---

## 📂 本地文件位置

所有文件都在：`D:\code\QaQ_bot\yuno-qq-bot\`

重要文件：
- `astrbot-plugin-yuno/` - AstrBot 插件包（完整）
- `DEPLOYMENT_CHECKLIST.md` - 详细部署清单
- `docs/astrbot-dual-service-deployment.md` - 架构说明文档
- `CLAUDE.md` - 项目开发指南
- `src/bootstrap-phase1.js` - 添加了 API 端点
- `src/astrbot-yuno-http-plugin.js` - 独立的 Node.js 插件（备用）

---

## 🆘 故障排查

### NapCat 报 401 错误
- 检查 NapCat 上报地址是否为 `http://astrbot:6199/onebot`
- 而不是 `http://yuno-qq-bot:3000/onebot`

### AstrBot 插件未加载
- 检查插件目录结构是否正确
- 确保有 `metadata.yaml` 和 `main.py`
- 查看 AstrBot 日志中的错误信息

### AstrBot 调用 API 失败
- 检查 `YUNO_API_URL` 是否为 `http://yuno-qq-bot:3000`
- 检查 `YUNO_API_SECRET` 和 `ONEBOT_WEBHOOK_SECRET` 是否一致
- 在 AstrBot Console 测试：`curl http://yuno-qq-bot:3000/health`

### AstrBot 端口冲突
- 在 AstrBot 配置中禁用 `platform_aiocqhttp_yuno`
- 设置 `enable: false`

---

## 📊 架构图

```
┌─────────┐
│  QQ 用户 │
└────┬────┘
     │
     ↓
┌──────────┐
│  NapCat  │  (OneBot 协议转换)
└────┬─────┘
     │ HTTP Post: /onebot
     ↓
┌──────────┐
│ AstrBot  │  (插件路由、权限管理)
└────┬─────┘
     │ HTTP API: /api/yuno/conversation
     ↓
┌─────────────┐
│ yuno-qq-bot │  (人格核心、记忆、情绪、知识)
└─────────────┘
```

---

## 🎉 部署完成后

当所有服务正常运行，你会看到：
- ✅ NapCat 连接 AstrBot 正常
- ✅ AstrBot 插件健康检查成功
- ✅ yuno-qq-bot 服务在线
- ✅ QQ 消息正常收发

此时 bot 已经完全运行在双服务架构下！

---

## 📚 相关文档

- `DEPLOYMENT_CHECKLIST.md` - 完整配置清单
- `docs/astrbot-dual-service-deployment.md` - 架构详解
- `astrbot-plugin-yuno/README.md` - 插件说明
- `CLAUDE.md` - 开发指南

---

## 💡 提示

1. **推送代码是关键**：插件通过 GitHub 安装最方便
2. **环境变量要一致**：API 密钥必须匹配
3. **NapCat 只连一个**：不要同时连 AstrBot 和 yuno-qq-bot
4. **查看日志排查**：Zeabur 的 Logs 标签很有用

祝部署顺利！🚀
