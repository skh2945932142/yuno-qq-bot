import { logger } from '../logger.js';
import { validateToolArgs } from '../schemas/tool-schema.js';

export function createToolRegistry(options = {}) {
  const registryLogger = options.logger || logger;
  const tools = new Map();

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
