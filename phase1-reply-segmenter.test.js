import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSegmentDelayMs,
  shouldSegmentReply,
  splitReplyIntoSegments,
} from './src/reply-segmenter.js';
import {
  createPrivateMessageAggregator,
  mergeAggregatedEvents,
  shouldAggregatePrivateEvent,
} from './src/message-aggregator.js';

test('splitReplyIntoSegments keeps short replies as a single message', () => {
  assert.deepEqual(splitReplyIntoSegments('嗯，在。'), ['嗯，在。']);
  assert.deepEqual(splitReplyIntoSegments(''), []);
});

test('splitReplyIntoSegments splits long multi-sentence replies within max count', () => {
  const text = '先说结论，这个方案是能落地的。不过你昨天提的那个风险点还是要先处理掉。处理完之后我们再看下一步怎么排期，别急着全部铺开。';
  const segments = splitReplyIntoSegments(text, { maxCount: 3 });

  assert.ok(segments.length >= 2 && segments.length <= 3);
  assert.equal(segments.join(''), text);
});

test('splitReplyIntoSegments never splits structured content', () => {
  const code = '你看这段：```js\nconsole.log(1)\n```再试一次。这样应该就可以了，别忘了保存。';
  assert.deepEqual(splitReplyIntoSegments(code), [code]);
  const link = '文档在 https://example.com/a 这里。你先看第三节，看完再来问我，我们对一下理解。';
  assert.deepEqual(splitReplyIntoSegments(link), [link]);
  const heading = '# 操作说明\n第一步先检查配置是否正确。第二步确认连接状态是否正常。第三步再发送一次请求。';
  assert.deepEqual(splitReplyIntoSegments(heading), [heading]);
  const quote = '> 原始错误信息\n这条信息很关键。先确认发生时间。然后再看上下文。';
  assert.deepEqual(splitReplyIntoSegments(quote), [quote]);
  const table = '| 项目 | 状态 |\n| --- | --- |\n| MongoDB | 正常 |\n接下来再检查模型连接。然后重新发送请求。';
  assert.deepEqual(splitReplyIntoSegments(table), [table]);
});

test('splitReplyIntoSegments handles English sentence boundaries and invalid options', () => {
  const text = 'This reply is long enough to split into chat bubbles. It keeps sentence boundaries intact. It also avoids one giant mechanical paragraph.';
  const segments = splitReplyIntoSegments(text, { maxCount: 3 });
  assert.ok(segments.length >= 2);
  assert.equal(segments.join(' '), text);
  assert.deepEqual(splitReplyIntoSegments(text, { maxCount: -1 }), splitReplyIntoSegments(text, { maxCount: 3 }));
  assert.equal(resolveSegmentDelayMs('test', { minDelayMs: -10, maxDelayMs: -20 }) >= 0, true);

  const email = '请发到 test@example.com。收到后我会继续处理。然后再确认最终结果。';
  assert.equal(splitReplyIntoSegments(email).join(''), email);
  const version = 'Node.js 22.1 已经可用了。升级前先检查依赖。升级后再跑完整测试。';
  assert.equal(splitReplyIntoSegments(version).join(''), version);
});

test('shouldSegmentReply only applies to private non-knowledge chat', () => {
  const longText = '这句话足够长，明显超过了分段发送的最小长度阈值，所以在私聊普通对话里可以被拆分成多条发送。';
  assert.equal(shouldSegmentReply({
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    text: longText,
  }), true);
  assert.equal(shouldSegmentReply({
    event: { chatType: 'group' },
    route: { category: 'group_chat' },
    text: longText,
  }), false);
  assert.equal(shouldSegmentReply({
    event: { chatType: 'private' },
    route: { category: 'knowledge_qa' },
    text: longText,
  }), false);
  assert.equal(shouldSegmentReply({
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    text: '短。',
  }), false);
});

test('resolveSegmentDelayMs stays within configured bounds', () => {
  const short = resolveSegmentDelayMs('嗯。', { minDelayMs: 600, maxDelayMs: 1400 });
  const long = resolveSegmentDelayMs('这一段特别长'.repeat(20), { minDelayMs: 600, maxDelayMs: 1400 });
  assert.ok(short >= 600 && short <= 1400);
  assert.equal(long, 1400);
});

test('shouldAggregatePrivateEvent filters commands, groups, and notices', () => {
  const runtimeConfig = { privateMessageAggregationEnabled: true };
  assert.equal(shouldAggregatePrivateEvent({
    chatType: 'private', rawText: '你在吗', source: { postType: 'message' },
  }, runtimeConfig), true);
  assert.equal(shouldAggregatePrivateEvent({
    chatType: 'private', rawText: '/help', source: { postType: 'message' },
  }, runtimeConfig), false);
  assert.equal(shouldAggregatePrivateEvent({
    chatType: 'group', rawText: 'hello', source: { postType: 'message' },
  }, runtimeConfig), false);
  assert.equal(shouldAggregatePrivateEvent({
    chatType: 'private', rawText: '/poke', source: { postType: 'notice' },
  }, runtimeConfig), false);
  assert.equal(shouldAggregatePrivateEvent({
    chatType: 'private', rawText: 'hello', source: { postType: 'message' },
  }, { privateMessageAggregationEnabled: false }), false);
});

test('mergeAggregatedEvents joins texts and attachments in order', () => {
  const merged = mergeAggregatedEvents([
    { rawText: '在吗', text: '在吗', messageId: 'm1', attachments: [] },
    { rawText: '我想问个事', text: '我想问个事', messageId: 'm2', attachments: [{ type: 'image' }] },
    { rawText: '就是昨天那个', text: '就是昨天那个', messageId: 'm3', attachments: [] },
  ]);

  assert.equal(merged.rawText, '在吗\n我想问个事\n就是昨天那个');
  assert.equal(merged.messageId, 'm3');
  assert.equal(merged.aggregatedCount, 3);
  assert.deepEqual(merged.aggregatedMessageIds, ['m1', 'm2', 'm3']);
  assert.deepEqual(merged.attachments, [{ type: 'image' }]);
});

test('mergeAggregatedEvents passes single events through unchanged', () => {
  const single = { rawText: 'hi', messageId: 'm1' };
  assert.equal(mergeAggregatedEvents([single]), single);
  assert.equal(mergeAggregatedEvents([]), null);
});

test('aggregator merges rapid messages into one ordered processing call', async () => {
  const aggregator = createPrivateMessageAggregator({
    privateMessageAggregationEnabled: true,
    windowMs: 30,
    maxWindowMs: 100,
  });
  const seen = [];
  const eventA = { platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'a', messageId: 'm1' };
  const eventB = { platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'b', messageId: 'm2' };
  const first = aggregator.reserve(eventA);
  const second = aggregator.reserve(eventB);
  const process = async (event) => seen.push(event);

  const results = await Promise.all([
    aggregator.submit(first, { process }),
    aggregator.submit(second, { process }),
  ]);

  assert.deepEqual(results.map((item) => item.type), ['superseded', 'processed']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].rawText, 'a\nb');
  assert.deepEqual(seen[0].aggregatedMessageIds, ['m1', 'm2']);
  assert.equal(aggregator.size(), 0);
});

test('aggregator preserves reservation order when middleware submissions finish out of order', async () => {
  const aggregator = createPrivateMessageAggregator({
    privateMessageAggregationEnabled: true,
    windowMs: 20,
    maxWindowMs: 80,
  });
  const seen = [];
  const first = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'first', messageId: 'm1' });
  const second = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'second', messageId: 'm2' });
  const process = async (event) => seen.push(event.rawText);

  const secondPromise = aggregator.submit(second, { process });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const firstPromise = aggregator.submit(first, { process });
  await Promise.all([firstPromise, secondPromise]);

  assert.deepEqual(seen, ['first\nsecond']);
});

test('aggregator treats no-slash commands as ordered non-aggregate barriers', async () => {
  const runtimeConfig = { privateMessageAggregationEnabled: true };
  assert.equal(shouldAggregatePrivateEvent({
    chatType: 'private', rawText: 'remind add 5 喝水', source: { postType: 'message' },
  }, runtimeConfig), false);

  const aggregator = createPrivateMessageAggregator({
    ...runtimeConfig,
    windowMs: 50,
    maxWindowMs: 100,
  });
  const seen = [];
  const chat = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: '先别删', messageId: 'm1' });
  const command = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: '/forget 张三', messageId: 'm2' });
  const process = async (event) => seen.push(event.rawText);

  await Promise.all([
    aggregator.submit(command, { process }),
    aggregator.submit(chat, { process }),
  ]);
  assert.deepEqual(seen, ['先别删', '/forget 张三']);
});

test('aggregator enforces a hard maximum window under continuous input', async () => {
  const aggregator = createPrivateMessageAggregator({
    privateMessageAggregationEnabled: true,
    windowMs: 80,
    maxWindowMs: 100,
  });
  const startedAt = Date.now();
  const first = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: '0', messageId: 'm0' });
  const promises = [aggregator.submit(first, { process: async () => null })];
  for (let index = 1; index <= 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const entry = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: String(index), messageId: `m${index}` });
    promises.push(aggregator.submit(entry, { process: async () => null }));
  }
  await promises[0];
  assert.ok(Date.now() - startedAt < 180);
  await aggregator.close({ flush: true });
});

test('aggregator expires an unsubmitted reservation so later messages are not blocked', async () => {
  const aggregator = createPrivateMessageAggregator({
    privateMessageAggregationEnabled: true,
    windowMs: 20,
    maxWindowMs: 40,
  });
  const seen = [];
  aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'stuck', messageId: 'm-stuck' });
  const next = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'next', messageId: 'm-next' });
  const outcome = await aggregator.submit(next, {
    process: async (event) => seen.push(event.rawText),
  });

  assert.equal(outcome.type, 'processed');
  assert.deepEqual(seen, ['next']);
  await aggregator.close({ flush: false });
});

test('aggregator close flushes and waits for active processing', async () => {
  const aggregator = createPrivateMessageAggregator({
    privateMessageAggregationEnabled: true,
    windowMs: 100,
    maxWindowMs: 500,
  });
  let finished = false;
  const entry = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'a', messageId: 'm1' });
  aggregator.submit(entry, {
    process: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    },
  });

  await aggregator.close({ flush: true });
  assert.equal(finished, true);
});

test('aggregator keeps different sessions independent', async () => {
  const aggregator = createPrivateMessageAggregator({
    privateMessageAggregationEnabled: true,
    windowMs: 20,
    maxWindowMs: 80,
  });
  const seen = [];
  const first = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u1', userId: 'u1', rawText: 'a', messageId: 'm1' });
  const second = aggregator.reserve({ platform: 'qq', chatType: 'private', chatId: 'u2', userId: 'u2', rawText: 'b', messageId: 'm2' });
  await Promise.all([
    aggregator.submit(first, { process: async (event) => seen.push(event.messageId) }),
    aggregator.submit(second, { process: async (event) => seen.push(event.messageId) }),
  ]);

  assert.deepEqual(new Set(seen), new Set(['m1', 'm2']));
});
