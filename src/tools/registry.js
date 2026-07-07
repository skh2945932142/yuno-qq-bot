import { logger } from '../logger.js';
import { config } from '../config.js';
import { validateToolArgs } from '../schemas/tool-schema.js';

function isAdminContext(context = {}, options = {}) {
  const adminUserId = String(options.adminUserId ?? config.adminQq ?? '');
  const userId = String(context.event?.userId ?? context.userId ?? '');
  return Boolean(adminUserId && userId && adminUserId === userId);
}

function assertToolPermission(tool, context = {}, options = {}) {
  const permissions = Array.isArray(tool.permissions) ? tool.permissions : [];
  if (permissions.length === 0 || permissions.includes('member')) {
    return;
  }

  if (permissions.includes('admin') && isAdminContext(context, options)) {
    return;
  }

  throw new Error(`Tool ${tool.name} requires admin permission`);
}

function getToolRateLimitMs(tool) {
  const rawLimit = tool.rateLimitMs ?? tool.metadata?.rateLimitMs ?? 0;
  const parsed = Number(rawLimit);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function buildRateLimitKey(tool, context = {}) {
  const event = context.event || {};
  return [
    event.platform || 'unknown',
    event.userId || context.userId || 'unknown-user',
    event.chatType || 'unknown-chat-type',
    event.chatId || 'unknown-chat',
    tool.name,
  ].map((item) => String(item)).join(':');
}

export function createToolRegistry(options = {}) {
  const registryLogger = options.logger || logger;
  const tools = new Map();
  const rateLimitState = options.rateLimitState || new Map();
  const nowMs = typeof options.nowMs === 'function' ? options.nowMs : () => Date.now();

  function assertToolRateLimit(tool, context = {}) {
    const limitMs = getToolRateLimitMs(tool);
    if (limitMs <= 0 || isAdminContext(context, options)) {
      return;
    }

    const key = buildRateLimitKey(tool, context);
    const now = nowMs();
    const lastUsedAt = Number(rateLimitState.get(key) || 0);
    const elapsed = now - lastUsedAt;
    if (lastUsedAt > 0 && elapsed < limitMs) {
      const waitMs = Math.max(1, limitMs - elapsed);
      throw new Error(`Tool ${tool.name} is rate limited; try again in ${waitMs}ms`);
    }

    rateLimitState.set(key, now);
  }

  return {
    register(tool) {
      if (!tool?.name) {
        throw new Error('Tool name is required');
      }

      if (tools.has(tool.name)) {
        return tools.get(tool.name);
      }

      tools.set(tool.name, tool);
      return tool;
    },

    get(name) {
      return tools.get(name) || null;
    },

    list() {
      return [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },

    async execute(name, args = {}, context = {}, trace = null) {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const validation = validateToolArgs(tool, args);
      if (!validation.ok) {
        throw new Error(`Invalid tool input for ${name}: ${validation.errors.join('; ')}`);
      }
      assertToolPermission(tool, context, options);
      assertToolRateLimit(tool, context);

      registryLogger.info('tool', 'Tool execution started', {
        traceId: trace?.traceId,
        toolName: name,
      });

      try {
        const result = await tool.execute(args, context);
        registryLogger.info('tool', 'Tool execution completed', {
          traceId: trace?.traceId,
          toolName: name,
        });
        return result;
      } catch (error) {
        registryLogger.error('tool', 'Tool execution failed', {
          traceId: trace?.traceId,
          toolName: name,
          message: error.message,
        });
        throw error;
      }
    },
  };
}

export const toolRegistry = createToolRegistry();
