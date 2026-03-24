import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYunoCoreEvent, runYunoConversation } from './src/yuno-core.js';

test('buildYunoCoreEvent normalizes generic platform input into unified event', () => {
  const event = buildYunoCoreEvent({
    platform: 'telegram',
    scene: 'private',
    userId: '42',
    username: 'Scathach',
    rawMessage: 'hello',
    metadata: {
      messageId: 'msg-1',
      mentionsBot: true,
    },
  });

  assert.equal(event.platform, 'telegram');
  assert.equal(event.chatType, 'private');
  assert.equal(event.chatId, '42');
  assert.equal(event.userId, '42');
  assert.equal(event.userName, 'Scathach');
  assert.equal(event.rawText, 'hello');
});

test('runYunoConversation captures output without using platform sender', async () => {
  const result = await runYunoConversation({
    platform: 'qq',
    scene: 'private',
    userId: '10001',
    username: 'Alice',
    rawMessage: 'what can you do?',
  }, {
    engine: {
      shouldRespondToEvent: async (event) => ({
        event,
        analysis: {
          shouldRespond: true,
          confidence: 0.9,
          intent: 'query',
          sentiment: 'neutral',
          relevance: 0.9,
          reason: 'test',
          topics: [],
          ruleSignals: ['private-chat'],
          replyStyle: 'calm',
        },
      }),
      processIncomingMessage: async (_event, _decision, runtimeOptions) => {
        await runtimeOptions.deps.sendReply({ platform: 'qq', chatType: 'private', chatId: '10001' }, 'test reply');
        return 'test reply';
      },
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.response.text, 'test reply');
  assert.equal(result.outputs.replies[0].text, 'test reply');
});

test('runYunoConversation formats tool results into unified outputs', async () => {
  const result = await runYunoConversation({
    platform: 'qq',
    scene: 'private',
    userId: '10001',
    username: 'Alice',
    rawMessage: '/help',
  }, {
    context: {
      relation: { affection: 20 },
    },
    toolResult: {
      tool: 'meme_generate',
      payload: {
        action: 'generate-quote',
        image: { file: 'data:image/png;base64,AAA' },
      },
      summary: '',
      visibility: 'default',
      safetyFlags: [],
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.response.outputs.length, 2);
  assert.equal(result.response.outputs[0].type, 'text');
  assert.equal(result.response.outputs[1].type, 'image');
});
