# Yuno QQ Bot - AstrBot 插件

通过 HTTP API 连接到 yuno-qq-bot 服务的 AstrBot 插件。

## 功能特性

- 通过 HTTP API 调用 Yuno 人格核心
- 支持完整的消息分析、记忆、情绪、知识检索
- 自动健康检查和错误处理
- 支持 API 密钥验证

## 安装方式

### 方法 1：通过 GitHub 安装（推荐）

1. 在 AstrBot 插件管理界面
2. 选择"从 GitHub 安装"
3. 输入仓库地址：`https://github.com/skh2945932142/yuno-qq-bot.git`
4. 插件目录：`astrbot-plugin-yuno`

### 方法 2：手动安装

1. 将整个 `astrbot-plugin-yuno` 目录复制到 AstrBot 的插件目录
2. 重启 AstrBot

## 配置

### 环境变量

在 AstrBot 的环境变量中配置：

```bash
YUNO_API_URL=http://yuno-qq-bot:3000
YUNO_API_SECRET=yuno-api-secret-2024
```

### yuno-qq-bot 服务配置

确保 yuno-qq-bot 服务已启动，并配置了相同的 API 密钥：

```bash
ONEBOT_WEBHOOK_SECRET=yuno-api-secret-2024
NODE_ENV=development
```

## 架构

```
NapCat → AstrBot → HTTP API → yuno-qq-bot
```

## 依赖

- Python 3.8+
- aiohttp

## 故障排查

### 插件加载失败

确保 `metadata.yaml` 和 `main.py` 都在插件目录中。

### 健康检查失败

检查：
1. yuno-qq-bot 服务是否运行
2. `YUNO_API_URL` 是否正确
3. 网络连通性（在 AstrBot 容器中运行 `curl http://yuno-qq-bot:3000/health`）

### 401 认证失败

检查 `YUNO_API_SECRET` 和 yuno-qq-bot 的 `ONEBOT_WEBHOOK_SECRET` 是否一致。

## 更多信息

详细部署指南请参考：`docs/astrbot-dual-service-deployment.md`
