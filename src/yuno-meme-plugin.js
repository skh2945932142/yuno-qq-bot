import { config } from './config.js';
import { collectMemeAssetForEvent } from './meme-collector.js';
import { searchMemeLibrary, markMemeUsed } from './meme-library.js';
import { generateQuoteMeme } from './meme-generator.js';
import { parseMemeTrigger } from './meme-trigger.js';
import { decideMemeAction } from './meme-agent.js';
import { assessMemeSafety } from './meme-safety.js';

export function createYunoMemePlugin({ runConversation, repositoryDeps = {}, memeConfig = {} } = {}) {
  const resolvedConfig = {
    memeEnabled: config.memeEnabled,
    memeAutoCollect: config.memeAutoCollect,
    memeAutoSend: config.memeAutoSend,
    memeEnabledGroups: config.memeEnabledGroups,
    memeOptOutUsers: config.memeOptOutUsers,
    ...memeConfig,
  };

  return {
    name: 'yuno-meme',
    priority: 20,
    async observe(context) {
      return collectMemeAssetForEvent(context.event, resolvedConfig, repositoryDeps);
    },
    match(context) {
      const trigger = parseMemeTrigger(context.message || context.rawMessage || context.text || '');
      return trigger.explicit || trigger.semiAuto || (Array.isArray(context.event.attachments) && context.event.attachments.some((item) => item.type === 'image'));
    },
    async handle(context) {
      const safety = assessMemeSafety({
        text: context.event.rawText || context.event.text || '',
        attachments: context.event.attachments,
        username: context.event.userName,
      });
      const candidates = await searchMemeLibrary({
        chatId: context.event.chatId,
        userId: context.event.userId,
        text: context.event.rawText || context.event.text || '',
        limit: 3,
      }, repositoryDeps);
      const action = decideMemeAction({
        event: context.event,
        analysis: context.analysis || {},
        candidates,
        safety,
        autoSend: resolvedConfig.memeAutoSend,
      });

      if (action.action === 'collect') {
        const collected = await collectMemeAssetForEvent(context.event, resolvedConfig, repositoryDeps);
        if (!collected?.collected) {
          return null;
        }

        return runConversation(context.input, {
          responseMode: 'capture',
          toolResult: {
            tool: 'meme_collect',
            payload: {
              action: 'collect',
              assetId: collected.asset.assetId,
              tags: collected.asset.tags,
            },
            summary: '',
            visibility: 'default',
            safetyFlags: collected.safety.safetyFlags,
          },
        });
      }

      if (action.action === 'send-existing' && action.candidate) {
        await markMemeUsed(action.candidate.assetId, repositoryDeps);
        return runConversation(context.input, {
          responseMode: 'capture',
          toolResult: {
            tool: 'meme_retrieve',
            payload: {
              action: 'send-existing',
              assetId: action.candidate.assetId,
              image: {
                file: action.candidate.storagePath || action.candidate.imageUrl,
              },
            },
            summary: '',
            visibility: 'default',
            safetyFlags: safety.safetyFlags,
          },
        });
      }

      if (action.action === 'generate-quote') {
        const image = generateQuoteMeme({
          username: context.input.username || context.event.userName,
          text: context.event.text || context.event.rawText,
          avatarUrl: context.event.sender?.avatar || '',
        });
        return runConversation(context.input, {
          responseMode: 'capture',
          toolResult: {
            tool: 'meme_generate',
            payload: {
              action: 'generate-quote',
              image,
            },
            summary: '',
            visibility: 'default',
            safetyFlags: safety.safetyFlags,
          },
        });
      }

      return null;
    },
  };
}
