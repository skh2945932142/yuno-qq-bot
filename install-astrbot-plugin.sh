#!/bin/bash
# AstrBot Yuno 插件安装脚本
# 在 AstrBot Console 中运行此脚本

set -e

echo "开始安装 Yuno 插件..."

# 进入插件目录
cd /AstrBot/data/plugins

# 创建插件目录
mkdir -p yuno_qq_bot
cd yuno_qq_bot

# 创建 metadata.yaml
cat > metadata.yaml << 'EOF'
name: yuno_qq_bot
version: 1.0.0
author: Yuno Bot Team
desc: Yuno 人格核心 HTTP 调用插件，通过 API 连接到 yuno-qq-bot 服务
repo: https://github.com/skh2945932142/yuno-qq-bot
EOF

echo "✓ metadata.yaml 创建完成"

# 创建 main.py
cat > main.py << 'EOF'
import os
import aiohttp
from astrbot.api.event import AstrMessageEvent
from astrbot.api.star import Context, Star, register


def normalize_scene(context):
    """规范化场景类型"""
    scene = str(context.type or 'group').lower()
    return 'private' if scene == 'private' else 'group'


def adapt_astrbot_message(event: AstrMessageEvent):
    """将 AstrBot 消息事件转换为 Yuno API 格式"""
    scene = 'private' if event.message_type == 'private' else 'group'
    user_id = str(event.sender.user_id if event.sender else '')
    group_id = str(event.group_id or '')
    chat_id = group_id if scene == 'group' else user_id

    return {
        'platform': 'qq',
        'scene': scene,
        'userId': user_id,
        'groupId': group_id,
        'chatId': chat_id,
        'username': event.sender.nickname if event.sender else user_id,
        'rawMessage': event.message_str,
        'metadata': {
            'adapter': 'astrbot',
            'messageId': str(event.message_id or ''),
            'replyTo': '',
            'mentionsBot': event.is_at,
            'attachments': [],
            'timestamp': event.timestamp * 1000 if event.timestamp else None,
            'source': {
                'platform': 'qq',
                'plugin': 'yuno-http-entry',
            },
            'sender': {
                'userId': user_id,
                'nickname': event.sender.nickname if event.sender else '',
            },
        },
    }


@register(name="yuno_http_entry", desc="Yuno 人格核心插件", author="Yuno Bot Team", version="1.0.0")
class YunoHttpPlugin(Star):
    """Yuno HTTP 调用插件"""

    def __init__(self, context: Context):
        super().__init__(context)
        self.yuno_api_url = os.getenv('YUNO_API_URL', 'http://yuno-qq-bot:3000')
        self.yuno_api_secret = os.getenv('YUNO_API_SECRET', '')
        self.request_timeout = 30
        self.session = None

    async def _ensure_session(self):
        """确保 HTTP 会话已创建"""
        if self.session is None:
            self.session = aiohttp.ClientSession()

    async def _call_yuno_api(self, input_data, request_options=None):
        """调用 Yuno API"""
        await self._ensure_session()

        headers = {'Content-Type': 'application/json'}
        if self.yuno_api_secret:
            headers['x-yuno-api-secret'] = self.yuno_api_secret

        payload = {
            'input': input_data,
            'responseMode': 'capture',
        }

        if request_options:
            payload.update(request_options)

        try:
            async with self.session.post(
                f'{self.yuno_api_url}/api/yuno/conversation',
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=self.request_timeout)
            ) as response:
                if response.status == 401:
                    raise Exception('Yuno API 认证失败，请检查 YUNO_API_SECRET 配置')
                if response.status != 200:
                    text = await response.text()
                    raise Exception(f'Yuno API 错误: {response.status} - {text}')

                return await response.json()
        except aiohttp.ClientError as e:
            raise Exception(f'Yuno API 请求失败: {str(e)}')

    async def _check_health(self):
        """健康检查"""
        await self._ensure_session()

        try:
            async with self.session.get(
                f'{self.yuno_api_url}/health',
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    text = await response.text()
                    self.logger.info(f'Yuno 服务健康检查成功: {text}')
                    return True
                else:
                    self.logger.warning(f'Yuno 服务健康检查失败: HTTP {response.status}')
                    return False
        except Exception as e:
            self.logger.warning(f'Yuno 服务健康检查失败: {str(e)}')
            return False

    async def _on_plugin_load(self):
        """插件加载时调用"""
        self.logger.info(f'Yuno HTTP 插件已加载，API 地址: {self.yuno_api_url}')
        await self._check_health()

    async def _on_plugin_unload(self):
        """插件卸载时调用"""
        if self.session:
            await self.session.close()
            self.session = None
        self.logger.info('Yuno HTTP 插件已卸载')

    async def handle(self, event: AstrMessageEvent) -> None:
        """处理消息事件"""
        try:
            # 转换消息格式
            input_data = adapt_astrbot_message(event)

            # 调用 Yuno API
            result = await self._call_yuno_api(input_data)

            # 检查结果
            if not result or result.get('suppressed'):
                return

            response = result.get('response', {})
            reply_text = response.get('text', '')

            if not reply_text:
                return

            # 发送回复
            await event.send(reply_text)

            # 处理语音（如果有）
            voices = response.get('voices', [])
            if voices:
                for voice in voices:
                    if voice.get('type') == 'voice' and voice.get('audio'):
                        # TODO: 发送语音消息
                        pass

        except Exception as e:
            self.logger.error(f'Yuno 插件处理消息失败: {str(e)}')
EOF

echo "✓ main.py 创建完成"

# 创建 requirements.txt
cat > requirements.txt << 'EOF'
aiohttp>=3.8.0
EOF

echo "✓ requirements.txt 创建完成"

# 创建 README.md
cat > README.md << 'EOF'
# Yuno QQ Bot - AstrBot 插件

通过 HTTP API 连接到 yuno-qq-bot 服务的 AstrBot 插件。

## 配置

在 AstrBot 环境变量中配置：

```
YUNO_API_URL=http://yuno-qq-bot:3000
YUNO_API_SECRET=yuno-api-secret-2024
```

## 安装

插件已通过脚本自动安装。重启 AstrBot 即可生效。
EOF

echo "✓ README.md 创建完成"

# 显示文件列表
echo ""
echo "✓ 插件安装完成！文件列表："
ls -lah

echo ""
echo "接下来："
echo "1. 在 Zeabur AstrBot 服务中配置环境变量"
echo "2. 重启 AstrBot 服务"
echo "3. 查看日志确认插件加载成功"
