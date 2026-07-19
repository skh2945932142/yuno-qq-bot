import os
import aiohttp
from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register


def _safe_getattr(obj, name, default=''):
    return getattr(obj, name, default) if obj is not None else default


def _normalize_text(value):
    return str(value or '').strip()


def _extract_reply_texts(result):
    """从新旧两种 Yuno API 返回格式中提取文本回复。"""
    if not result or result.get('suppressed'):
        return []

    texts = []
    response = result.get('response') or {}
    legacy_text = _normalize_text(response.get('text'))
    if legacy_text:
        texts.append(legacy_text)

    outputs = result.get('outputs') or response.get('outputs') or {}
    replies = outputs.get('replies') if isinstance(outputs, dict) else []
    if isinstance(replies, list):
        for item in replies:
            if not isinstance(item, dict):
                continue
            text = _normalize_text(item.get('text'))
            if item.get('type') == 'text' and text:
                texts.append(text)

    deduped = []
    seen = set()
    for text in texts:
        if text in seen:
            continue
        seen.add(text)
        deduped.append(text)
    return deduped


def _get_event_extra(event, key, default=None):
    getter = getattr(event, 'get_extra', None)
    if callable(getter):
        try:
            return getter(key, default=default)
        except TypeError:
            try:
                value = getter(key)
                return default if value is None else value
            except TypeError:
                pass

    extras = getattr(event, '_extras', None)
    if isinstance(extras, dict):
        return extras.get(key, default)
    return default


def _has_activated_astrbot_command_handler(event):
    """让 AstrBot 已命中的命令处理器优先执行，避免 Yuno 把插件命令当聊天接管。"""
    handlers = _get_event_extra(event, 'activated_handlers', default=[]) or []
    for handler in handlers:
        for event_filter in getattr(handler, 'event_filters', []) or []:
            filter_name = type(event_filter).__name__
            if filter_name in {'CommandFilter', 'CommandGroupFilter'}:
                return True
    return False


def adapt_astrbot_message(event: AstrMessageEvent):
    """将 AstrBot 消息事件转换为 Yuno API 格式"""
    scene = 'private' if event.is_private_chat() else 'group'
    user_id = _normalize_text(event.get_sender_id())
    group_id = _normalize_text(event.get_group_id())
    chat_id = group_id if scene == 'group' else user_id
    message_id = _safe_getattr(event.message_obj, 'message_id', '')

    return {
        'platform': 'qq',
        'scene': scene,
        'userId': user_id,
        'groupId': group_id,
        'chatId': chat_id,
        'username': event.get_sender_name() or user_id,
        'rawMessage': event.get_message_str(),
        'metadata': {
            'adapter': 'astrbot',
            'messageId': _normalize_text(message_id),
            'replyTo': '',
            'mentionsBot': bool(
                _safe_getattr(event, 'is_at', False)
                or _safe_getattr(event, 'is_at_or_wake_command', False)
            ),
            'attachments': [],
            'timestamp': int(event.created_at * 1000) if event.created_at else None,
            'source': {
                'platform': 'qq',
                'plugin': 'yuno-http-entry',
            },
            'sender': {
                'userId': user_id,
                'nickname': event.get_sender_name(),
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
                    logger.info(f'Yuno 服务健康检查成功: {text}')
                    return True
                else:
                    logger.warning(f'Yuno 服务健康检查失败: HTTP {response.status}')
                    return False
        except Exception as e:
            logger.warning(f'Yuno 服务健康检查失败: {str(e)}')
            return False

    async def _on_plugin_load(self):
        """插件加载时调用"""
        logger.info(f'Yuno HTTP 插件已加载，API 地址: {self.yuno_api_url}')
        await self._check_health()

    async def _on_plugin_unload(self):
        """插件卸载时调用"""
        if self.session:
            await self.session.close()
            self.session = None
        logger.info('Yuno HTTP 插件已卸载')

    async def initialize(self):
        await self._on_plugin_load()

    async def terminate(self):
        await self._on_plugin_unload()

    @filter.event_message_type(filter.EventMessageType.ALL)
    async def handle(self, event: AstrMessageEvent):
        """处理消息事件"""
        try:
            if _has_activated_astrbot_command_handler(event):
                logger.info('Yuno 跳过 AstrBot 命令消息，交由命令插件处理')
                return

            # 转换消息格式
            input_data = adapt_astrbot_message(event)
            logger.info(
                f'Yuno 开始处理消息: scene={input_data["scene"]}, '
                f'chatId={input_data["chatId"]}, userId={input_data["userId"]}'
            )

            # 调用 Yuno API
            result = await self._call_yuno_api(input_data)

            # 检查结果
            reply_texts = _extract_reply_texts(result)
            if not reply_texts:
                return

            logger.info(f'Yuno 生成 {len(reply_texts)} 条文本回复')
            for reply_text in reply_texts:
                yield event.plain_result(reply_text).stop_event()

        except Exception as e:
            logger.error(f'Yuno 插件处理消息失败: {str(e)}')
