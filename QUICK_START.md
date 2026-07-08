# 🚀 最终操作清单（3 步完成部署）

## 📊 当前状态

✅ 代码开发完成  
✅ 4 个本地 Git 提交  
⏳ 等待推送到 GitHub  
⏳ 等待安装插件  
⏳ 等待配置环境变量  

---

## 第 1️⃣ 步：推送代码到 GitHub

**当网络恢复后运行：**

```bash
cd D:\code\QaQ_bot\yuno-qq-bot
git push origin main
```

这会推送 4 个提交：
1. 添加 AstrBot 双服务架构支持和项目文档
2. 添加 AstrBot 官方插件包
3. 添加快速安装指南
4. 添加 AstrBot 插件一键安装脚本

---

## 第 2️⃣ 步：在 AstrBot 安装插件

### 方法 A：一键安装脚本（推荐）⭐

**在 Zeabur AstrBot 服务的 Console 中运行：**

```bash
cd /AstrBot/data/plugins
curl -fsSL https://raw.githubusercontent.com/skh2945932142/yuno-qq-bot/main/install-astrbot-plugin.sh | bash
```

**如果 curl 不可用，使用方法 B**

### 方法 B：手动安装

在 AstrBot Console 中运行：

```bash
# 进入插件目录
cd /AstrBot/data/plugins

# 创建插件目录
mkdir -p yuno_qq_bot
cd yuno_qq_bot

# 使用 vi 创建文件（因为 nano 不可用）
# 或者从 GitHub 下载
wget https://raw.githubusercontent.com/skh2945932142/yuno-qq-bot/main/astrbot-plugin-yuno/metadata.yaml
wget https://raw.githubusercontent.com/skh2945932142/yuno-qq-bot/main/astrbot-plugin-yuno/main.py
wget https://raw.githubusercontent.com/skh2945932142/yuno-qq-bot/main/astrbot-plugin-yuno/requirements.txt
```

**完成后查看文件：**
```bash
ls -lah /AstrBot/data/plugins/yuno_qq_bot/
```

应该看到：
- metadata.yaml
- main.py
- requirements.txt
- README.md（可选）

---

## 第 3️⃣ 步：配置环境变量

### 3.1 配置 yuno-qq-bot

在 Zeabur 网页界面：

1. 进入 **yuno-qq-bot** 服务
2. 点击 **Variables** 标签
3. 添加：
   ```
   ONEBOT_WEBHOOK_SECRET=yuno-api-secret-2024
   NODE_ENV=development
   ```
4. 点击 **Redeploy**

### 3.2 配置 AstrBot

在 Zeabur 网页界面：

1. 进入 **AstrBot** 服务
2. 点击 **Variables** 标签
3. 添加：
   ```
   YUNO_API_URL=http://yuno-qq-bot:3000
   YUNO_API_SECRET=yuno-api-secret-2024
   ```
4. 点击 **Redeploy**

### 3.3 配置 NapCat

在 NapCat WebUI 中：

1. **关闭**：
   - ❌ HTTP 客户端
   - ❌ WebSocket 客户端
   - ❌ 反向 WebSocket

2. **开启并配置 HTTP 服务端**：
   - ✅ 启用 HTTP 服务端（反向 HTTP / HTTP Post）
   - 上报地址：`http://astrbot:6199/onebot`
   - 不需要配置请求头

3. 保存并重启 NapCat

---

## ✅ 验证部署

### 查看日志

在 Zeabur 各服务的 **Logs** 标签：

**yuno-qq-bot:**
```
✓ Yuno online
✓ Server listening on port 3000
```

**AstrBot:**
```
✓ [Yuno HTTP Plugin] 已加载，API 地址: http://yuno-qq-bot:3000
✓ [Yuno HTTP Plugin] 健康检查成功: Yuno online
```

**NapCat:**
```
✓ HTTP 上报到 AstrBot 成功
✓ 不应该再有 401 或连接错误
```

### 测试消息

在 QQ 中向 bot 发送消息，观察：
1. NapCat 上报到 AstrBot ✓
2. AstrBot 调用 yuno-qq-bot API ✓
3. yuno-qq-bot 返回回复 ✓
4. 你收到 bot 的回复 ✓

---

## 🔧 故障排查

### 问题 1：curl 命令不存在

使用 **方法 B** 的 wget，或者：
```bash
apt update && apt install -y curl
```

### 问题 2：GitHub raw 文件无法访问

网络问题，等待恢复或使用代理。

### 问题 3：插件加载失败

检查文件是否存在：
```bash
ls -lah /AstrBot/data/plugins/yuno_qq_bot/
```

查看 AstrBot 日志中的错误信息。

### 问题 4：健康检查失败

测试连通性：
```bash
curl http://yuno-qq-bot:3000/health
```

应该返回：`Yuno online`

### 问题 5：API 认证失败

检查环境变量：
- AstrBot 的 `YUNO_API_SECRET`
- yuno-qq-bot 的 `ONEBOT_WEBHOOK_SECRET`

必须完全一致。

---

## 📋 本地文件位置

所有文件都在：`D:\code\QaQ_bot\yuno-qq-bot\`

**关键文件：**
- `install-astrbot-plugin.sh` - 一键安装脚本 ⭐
- `INSTALL_GUIDE.md` - 完整安装指南
- `DEPLOYMENT_CHECKLIST.md` - 详细配置清单
- `astrbot-plugin-yuno/` - 插件源码目录

---

## 🎯 完成标志

当你看到：
- ✅ 4 个提交已推送到 GitHub
- ✅ AstrBot 插件安装成功
- ✅ 环境变量配置完成
- ✅ 所有服务日志正常
- ✅ QQ 消息正常收发

恭喜！双服务架构部署完成！🎉

---

## 📚 相关文档

- **INSTALL_GUIDE.md** - 图文安装指南
- **DEPLOYMENT_CHECKLIST.md** - 详细配置清单
- **docs/astrbot-dual-service-deployment.md** - 架构详解
- **astrbot-plugin-yuno/README.md** - 插件说明

---

## 💡 小贴士

1. **推送代码是关键** - 没有代码在 GitHub，无法使用一键安装
2. **一键脚本最简单** - 避免手动创建文件的麻烦
3. **环境变量要一致** - API 密钥必须匹配
4. **查看日志排查** - 出问题先看日志

---

**现在开始第 1 步：等待网络恢复后推送代码！**
