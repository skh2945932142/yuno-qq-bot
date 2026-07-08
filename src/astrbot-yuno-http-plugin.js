import axios from 'axios';

function normalizeAstrBotScene(context = {}) {
  return String(context.scene || context.chatType || context.messageType || 'group').toLowerCase() === 'private'
    ? 'private'
    : 'group';
}

export function adaptAstrBotMessage(context = {}) {
  const scene = normalizeAstrBotScene(context);
  const userId = String(context.userId || context.sender?.userId || context.sender?.id || '').trim();
  const groupId = String(context.groupId || context.roomId || context.channelId || '').trim();
  const chatId = String(context.chatId || (scene === 'group' ? groupId : userId) || '').trim();
  const rawMessage = String(context.rawMessage || context.message || context.text || '').trim();

  return {
    platform: String(context.platform || 'astrbot').trim().toLowerCase() || 'astrbot',
    scene,
    userId,
    groupId,
    chatId,
    username: context.username || context.sender?.nickname || context.sender?.name || userId,
    rawMessage,
    metadata: {
      adapter: 'astrbot',
      messageId: context.messageId || context.id || '',
      replyTo: context.replyTo || '',
      mentionsBot: Boolean(context.mentionsBot),
      attachments: Array.isArray(context.attachments) ? context.attachments : [],
      timestamp: Number.isFinite(context.timestamp) ? context.timestamp : Date.now(),
      source: {
        platform: context.platform || 'astrbot',
        plugin: 'yuno-http-entry',
      },
      sender: context.sender || {},
    },
  };
}

export function createAstrBotYunoHttpPlugin(options = {}) {
  const yunoApiUrl = String(options.yunoApiUrl || process.env.YUNO_API_URL || 'http://yuno-qq-bot:3000').trim();
  const yunoApiSecret = String(options.yunoApiSecret || process.env.YUNO_API_SECRET || '').trim();
  const requestTimeout = Number(options.requestTimeout || 30000);

  async function callYunoApi(input, requestOptions = {}) {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (yunoApiSecret) {
      headers['x-yuno-api-secret'] = yunoApiSecret;
    }

    try {
      const response = await axios.post(
        `${yunoApiUrl}/api/yuno/conversation`,
        {
          input,
          responseMode: requestOptions.responseMode || 'capture',
          pluginRoute: requestOptions.pluginRoute,
          toolResult: requestOptions.toolResult,
        },
        {
          headers,
          timeout: requestTimeout,
        }
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Yuno API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Yuno API request failed: ${error.message}`);
    }
  }

  return {
    name: 'yuno-http-entry',
    metadata: {
      author: 'Yuno Bot',
      version: '1.0.0',
      description: 'Yuno 人格核心 HTTP 调用插件',
    },

    async onLoad() {
      console.log(`[Yuno HTTP Plugin] 已加载，API 地址: ${yunoApiUrl}`);

      // 测试连接
      try {
        const healthResponse = await axios.get(`${yunoApiUrl}/health`, { timeout: 5000 });
        console.log(`[Yuno HTTP Plugin] 健康检查成功: ${healthResponse.data}`);
      } catch (error) {
        console.warn(`[Yuno HTTP Plugin] 健康检查失败: ${error.message}`);
      }
    },

    async onMessage(context) {
      try {
        const input = adaptAstrBotMessage(context);
        const result = await callYunoApi(input);

        if (!result || result.suppressed || !result.response?.text) {
          return null;
        }

        return {
          plugin: 'yuno-http-entry',
          text: result.response.text,
          outputs: result.response.outputs || [],
          voices: result.response.voices || [],
          analysis: result.analysis,
          event: result.event,
        };
      } catch (error) {
        console.error(`[Yuno HTTP Plugin] 处理消息失败: ${error.message}`);
        return null;
      }
    },
  };
}

// 默认导出，供 AstrBot 加载
export default function createPlugin(options = {}) {
  return createAstrBotYunoHttpPlugin(options);
}
