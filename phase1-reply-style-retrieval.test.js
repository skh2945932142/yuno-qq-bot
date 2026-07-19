import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveReplyStyleExamples } from './src/reply-style-retriever.js';

const exampleCorpus = [
  {
    id: 'group-comfort-short',
    scene: 'group',
    intent: 'help',
    emotion: 'SAD',
    userText: '[CQ:at,qq=bot] 今天有点难受',
    humanReply: '先缓一下，别硬撑。你这句我听到了。',
    tags: ['comfort', 'short', 'group'],
    quality: 0.95,
  },
  {
    id: 'private-knowledge-long',
    scene: 'private',
    intent: 'knowledge_qa',
    emotion: 'CALM',
    userText: '你的设定是什么？',
    humanReply: '我先说重点，再补细节。',
    tags: ['knowledge', 'clear'],
    quality: 0.9,
  },
  {
    id: 'group-meme',
    scene: 'group',
    intent: 'chat',
    emotion: 'CALM',
    userText: '[CQ:at,qq=bot] 笑死，这也太抽象了',
    humanReply: '这个梗我接到了，确实有点离谱。',
    tags: ['meme', 'group'],
    quality: 0.88,
  },
];

test('retrieveReplyStyleExamples prefers same scene and intent style samples', async () => {
  const selected = await retrieveReplyStyleExamples({
    event: { chatType: 'group' },
    route: { category: 'group_chat' },
    analysis: { intent: 'help', sentiment: 'negative', ruleSignals: ['direct-mention'] },
    emotionResult: { emotion: 'SAD' },
    replyPlan: { interpretation: { needsEmpathy: true, subIntent: '情绪承接' } },
    userTurn: '今天有点难受',
    replyLengthProfile: { promptProfile: 'standard' },
  }, {
    examples: exampleCorpus,
  });

  assert.equal(selected[0].id, 'group-comfort-short');
  assert.equal(selected.length, 3);
  assert.ok(selected[0].score > selected[1].score);
});

test('retrieveReplyStyleExamples keeps fast prompts small and strips CQ codes', async () => {
  const selected = await retrieveReplyStyleExamples({
    event: { chatType: 'group' },
    route: { category: 'group_chat' },
    analysis: { intent: 'chat', sentiment: 'positive', ruleSignals: ['meme-topic'] },
    emotionResult: { emotion: 'CALM' },
    userTurn: '[CQ:at,qq=bot] 笑死，这也太抽象了',
    replyLengthProfile: { promptProfile: 'fast' },
  }, {
    examples: exampleCorpus,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'group-meme');
  assert.doesNotMatch(selected[0].userText, /\[CQ:/);
});

test('retrieveReplyStyleExamples prefers direct attention over generic comfort for companionship', async () => {
  const selected = await retrieveReplyStyleExamples({
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    analysis: { intent: 'social', sentiment: 'negative', ruleSignals: ['private-chat'] },
    emotionResult: { emotion: 'AFFECTIONATE' },
    replyPlan: {
      type: 'empathic_followup',
      interpretation: { needsEmpathy: true, subIntent: '亲近陪伴' },
    },
    userTurn: '陪我聊会儿，今天有点累',
    replyLengthProfile: { promptProfile: 'standard' },
  }, {
    examples: [
      {
        id: 'generic-comfort',
        scene: 'private',
        intent: 'help',
        emotion: 'SAD',
        userText: '我有点累',
        humanReply: '我在，你慢慢说。',
        tags: ['comfort'],
        quality: 0.96,
      },
      {
        id: 'direct-attention',
        scene: 'private',
        intent: 'social',
        emotion: 'AFFECTIONATE',
        userText: '陪我聊会儿',
        humanReply: '行，这会儿我先听你的。',
        tags: ['direct-attention', 'warm'],
        quality: 0.96,
      },
    ],
  });

  assert.equal(selected[0].id, 'direct-attention');
});
