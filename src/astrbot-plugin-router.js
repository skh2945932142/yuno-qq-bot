import { runYunoConversation } from './yuno-core.js';
import { buildYunoCoreEvent } from './yuno-core.js';
import { createYunoChatPlugin } from './yuno-chat-plugin.js';
import { createYunoKnowledgePlugin } from './yuno-knowledge-plugin.js';
import { createYunoMemePlugin } from './yuno-meme-plugin.js';
import { createYunoSchedulePlugin } from './yuno-schedule-plugin.js';
import { createYunoStatusPlugin } from './yuno-status-plugin.js';

function sortPlugins(plugins = []) {
  return [...plugins].sort((left, right) => Number(left.priority || 100) - Number(right.priority || 100));
}

export function createDefaultAstrBotPlugins(options = {}) {
  const runConversation = options.runConversation || runYunoConversation;
  return sortPlugins([
    createYunoMemePlugin({ runConversation, repositoryDeps: options.repositoryDeps, memeConfig: options.memeConfig }),
    createYunoStatusPlugin({ runConversation }),
    createYunoKnowledgePlugin({ runConversation }),
    createYunoSchedulePlugin({ runConversation }),
    createYunoChatPlugin({ runConversation }),
  ]);
}

export function createAstrBotPluginRouter(options = {}) {
  const plugins = sortPlugins(options.plugins?.length ? options.plugins : createDefaultAstrBotPlugins(options));

  return {
    plugins,
    async route(context = {}) {
      const input = context.input;
      if (!input) {
        throw new Error('AstrBot router requires a normalized input object');
      }
      const event = context.event || buildYunoCoreEvent(input);
      const pluginContext = {
        ...context,
        input,
        event,
        message: input.rawMessage,
        text: input.rawMessage,
        rawMessage: input.rawMessage,
      };

      for (const plugin of plugins) {
        if (typeof plugin.observe === 'function') {
          await plugin.observe(pluginContext);
        }
      }

      for (const plugin of plugins) {
        if (!plugin.match || plugin.match(pluginContext)) {
          const result = await plugin.handle(pluginContext);
          if (result) {
            return {
              plugin: plugin.name,
              ...result,
            };
          }
        }
      }

      return null;
    },
  };
}
