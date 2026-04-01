import test from 'node:test';
import assert from 'node:assert/strict';
import { createYunoStatusPlugin } from './src/yuno-status-plugin.js';

test('yuno status plugin creates a trace and preserves tool args', async () => {
  let capturedTrace = null;
  const plugin = createYunoStatusPlugin({
    runConversation: async (_input, options) => options,
    createTrace: (workflow, meta) => ({
      traceId: 'trace-1',
      workflow,
      meta,
      spans: [],
    }),
    buildContext: async (_event, trace) => {
      capturedTrace = trace;
      return {
        relation: { affection: 80 },
        userState: { currentEmotion: 'CALM' },
        userProfile: { profileSummary: 'stable' },
        groupState: { mood: 'CALM' },
      };
    },
    registry: {
      execute: async (toolName, toolArgs, context, trace) => {
        assert.equal(toolName, 'get_group_report');
        assert.equal(toolArgs.windowHours, 48);
        assert.equal(trace, capturedTrace);
        assert.equal(context.event.chatId, '200');
        return {
          tool: 'group_report',
          payload: { windowHours: 48 },
          summary: 'report ready',
          visibility: 'group',
          priority: 'normal',
          followUpHint: 'use /leaderboard',
          safetyFlags: [],
        };
      },
    },
  });

  const result = await plugin.handle({
    input: { rawMessage: '/groupreport 48' },
    event: { chatId: '200', userId: '100' },
  });

  assert.equal(result.responseMode, 'capture');
  assert.equal(result.toolResult.tool, 'group_report');
  assert.equal(result.toolResult.payload.windowHours, 48);
  assert.equal(result.toolResult.summary, 'report ready');
});
