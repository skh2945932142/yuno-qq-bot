import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMemeAction } from './src/meme-agent.js';
import { generateQuoteMeme } from './src/meme-generator.js';
import { assessMemeSafety } from './src/meme-safety.js';
import { planContextualMemeReply, resetMemeReplyPlannerState } from './src/meme-reply-planner.js';

test('meme agent generates quote meme for explicit quote command', () => {
  const result = decideMemeAction({
    event: {
      rawText: '把这句做成图',
      attachments: [],
    },
    analysis: { shouldRespond: true },
    candidates: [],
    safety: { allowed: true, safetyFlags: [] },
    autoSend: false,
  });

  assert.equal(result.action, 'generate-quote');
});

test('quote meme generator returns embeddable svg image', () => {
  const image = generateQuoteMeme({
    username: 'Alice',
    text: 'This is a test quote for a fake screenshot.',
  });

  assert.equal(image.type, 'image');
  assert.match(image.file, /^data:image\/svg\+xml;base64,/);
});

test('meme safety blocks privacy-heavy content', () => {
  const safety = assessMemeSafety({
    text: 'my phone is 13800138000 and my address is secret',
  });

  assert.equal(safety.allowed, false);
  assert.match(safety.safetyFlags.join(','), /privacy/);
});

test('contextual meme planner selects a safe meme for playful explicit context', () => {
  resetMemeReplyPlannerState();
  const result = planContextualMemeReply({
    event: {
      chatType: 'group',
      chatId: 'g1',
      userId: 'u1',
      rawText: '[CQ:at,qq=bot] 笑死，太离谱了',
      text: '笑死，太离谱了',
      mentionsBot: true,
    },
    route: { type: 'chat', category: 'group_chat' },
    analysis: { shouldRespond: true, intent: 'chat', sentiment: 'positive' },
    replyText: '确实有点绷不住。',
    memeCandidates: [{
      assetId: 'm1',
      storagePath: 'memes/funny.png',
      safetyStatus: 'safe',
      semanticTags: ['funny'],
      usageContext: 'group-reaction',
    }],
    settings: {
      memeEnabled: true,
      memeAutoSend: true,
      memeAutoSendMode: 'auto',
      memeEnabledGroups: ['g1'],
      memeOptOutUsers: [],
      memeAutoSendMinScore: 0.7,
      memeAutoSendCooldownMs: 300000,
      memeAutoSendMaxPerHour: 3,
    },
    now: new Date('2026-05-03T00:00:00Z'),
  });

  assert.equal(result.shouldSend, true);
  assert.equal(result.asset.assetId, 'm1');
  assert.equal(result.reason, 'high-semantic-match');
});

test('contextual meme planner suggests without sending in suggest mode', () => {
  resetMemeReplyPlannerState();
  const result = planContextualMemeReply({
    event: {
      chatType: 'private',
      chatId: 'u1',
      userId: 'u1',
      rawText: '笑死，这也太典了',
      text: '笑死，这也太典了',
      mentionsBot: false,
    },
    route: { type: 'chat', category: 'private_chat' },
    analysis: { shouldRespond: true, intent: 'chat', sentiment: 'positive' },
    replyText: '这句确实很适合配图。',
    memeCandidates: [{ assetId: 'm1', imageUrl: 'https://example.com/a.png', safetyStatus: 'safe' }],
    settings: {
      memeEnabled: true,
      memeAutoSend: false,
      memeAutoSendMode: 'suggest',
      memeEnabledGroups: [],
      memeOptOutUsers: [],
      memeAutoSendMinScore: 0.7,
    },
  });

  assert.equal(result.shouldSend, false);
  assert.equal(result.suggested, true);
  assert.equal(result.reason, 'suggest-only');
});

test('contextual meme planner skips serious or opted-out contexts', () => {
  resetMemeReplyPlannerState();
  const base = {
    event: {
      chatType: 'group',
      chatId: 'g1',
      userId: 'u1',
      rawText: '[CQ:at,qq=bot] 我今天很难受，怎么办',
      text: '我今天很难受，怎么办',
      mentionsBot: true,
    },
    route: { type: 'chat', category: 'group_chat' },
    analysis: { shouldRespond: true, intent: 'chat', sentiment: 'negative' },
    replyText: '先别硬撑，我陪你把事情拆开看。',
    memeCandidates: [{ assetId: 'm1', storagePath: 'memes/funny.png', safetyStatus: 'safe' }],
    settings: {
      memeEnabled: true,
      memeAutoSend: true,
      memeAutoSendMode: 'auto',
      memeEnabledGroups: ['g1'],
      memeOptOutUsers: [],
      memeAutoSendMinScore: 0.7,
    },
  };

  const serious = planContextualMemeReply(base);
  const optOut = planContextualMemeReply({
    ...base,
    event: { ...base.event, rawText: '笑死', text: '笑死' },
    userProfile: { memeOptOut: true },
  });

  assert.equal(serious.shouldSend, false);
  assert.equal(serious.reason, 'serious-context');
  assert.equal(optOut.shouldSend, false);
  assert.equal(optOut.reason, 'user-opt-out');
});

test('contextual meme planner enforces cooldown after a send', () => {
  resetMemeReplyPlannerState();
  const base = {
    event: {
      chatType: 'group',
      chatId: 'g1',
      userId: 'u1',
      rawText: '[CQ:at,qq=bot] 笑死',
      text: '笑死',
      mentionsBot: true,
    },
    route: { type: 'chat', category: 'group_chat' },
    analysis: { shouldRespond: true, intent: 'chat', sentiment: 'positive' },
    replyText: '确实。',
    memeCandidates: [{ assetId: 'm1', storagePath: 'memes/funny.png', safetyStatus: 'safe' }],
    settings: {
      memeEnabled: true,
      memeAutoSend: true,
      memeAutoSendMode: 'auto',
      memeEnabledGroups: ['g1'],
      memeOptOutUsers: [],
      memeAutoSendMinScore: 0.7,
      memeAutoSendCooldownMs: 300000,
      memeAutoSendMaxPerHour: 3,
    },
  };

  const first = planContextualMemeReply({ ...base, now: new Date('2026-05-03T00:00:00Z') });
  first.recordSent();
  const second = planContextualMemeReply({ ...base, now: new Date('2026-05-03T00:01:00Z') });

  assert.equal(first.shouldSend, true);
  assert.equal(second.shouldSend, false);
  assert.equal(second.reason, 'cooldown');
});
