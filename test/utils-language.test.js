import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractPreferences,
  extractTopics,
  inferIntent,
  inferSentiment,
} from '../src/utils.js';

const utilsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils.js');

// This suite exists because src/utils.js was once silently corrupted by a
// GBK -> UTF-8 conversion. Every Chinese literal became U+FFFD, so the whole
// rule-based semantic layer degraded to English-only while all 486 existing
// tests stayed green (their fixtures were English). Keep Chinese samples here.
test('src/utils.js contains no replacement characters', async () => {
  const source = await readFile(utilsPath, 'utf8');
  const corrupted = (source.match(/�/g) || []).length;
  assert.equal(corrupted, 0, `src/utils.js contains ${corrupted} U+FFFD characters; the file encoding is broken`);
});

test('inferSentiment detects Chinese negative wording', () => {
  for (const text of ['我讨厌这个', '好烦人', '气死我了', '真的会谢', '破防了', '有点恶心']) {
    assert.equal(inferSentiment(text), 'negative', text);
  }
});

test('inferSentiment detects everyday complaint phrasing', () => {
  for (const text of ['今天面试被问崩了，好烦', '好累啊', '我太累了', '有点委屈', 'emo了']) {
    assert.equal(inferSentiment(text), 'negative', text);
  }
});

test('inferSentiment does not read polite 麻烦 as a complaint', () => {
  // The word list deliberately uses 好烦/很烦/太烦 instead of the bare 烦, so
  // polite requests stay neutral.
  for (const text of ['麻烦你了', '不好意思麻烦一下', '麻烦帮我看看', '辛苦了']) {
    assert.notEqual(inferSentiment(text), 'negative', text);
  }
});

test('inferSentiment detects Chinese positive wording', () => {
  for (const text of ['谢谢你', '好可爱', '太好了', '我喜欢猫', '这个很靠谱']) {
    assert.equal(inferSentiment(text), 'positive', text);
  }
});

test('inferSentiment keeps English wording working', () => {
  assert.equal(inferSentiment('i hate this'), 'negative');
  assert.equal(inferSentiment('thanks, great work'), 'positive');
  assert.equal(inferSentiment(''), 'neutral');
});

test('inferSentiment treats negated sentiment as neutral', () => {
  for (const text of ['我不讨厌你', '没那么烦', '别生气', '我不是很喜欢', '谈不上喜欢']) {
    assert.equal(inferSentiment(text), 'neutral', text);
  }
});

test('inferIntent classifies Chinese intents', () => {
  const cases = [
    ['怎么办啊', 'help'],
    ['为什么会这样', 'help'],
    ['帮我看看', 'help'],
    ['你是谁', 'identity'],
    ['做个自我介绍', 'identity'],
    ['好感度多少', 'query'],
    ['我不服', 'challenge'],
    ['你凭什么这么说', 'challenge'],
    ['早安', 'social'],
    ['在吗', 'social'],
    ['今天天气不错', 'chat'],
    ['', 'ignore'],
  ];

  for (const [text, expected] of cases) {
    assert.equal(inferIntent(text), expected, text);
  }
});

test('inferIntent prefers the specific query keyword over generic help wording', () => {
  // "群状态如何" contains both a query keyword and the help keyword 如何.
  assert.equal(inferIntent('群状态如何'), 'query');
  assert.equal(inferIntent('状态怎么样'), 'query');
});

test('extractPreferences pulls Chinese preference objects', () => {
  assert.deepEqual(extractPreferences('我喜欢猫'), ['猫']);
  assert.deepEqual(extractPreferences('我想要奶茶'), ['奶茶']);
  assert.deepEqual(extractPreferences('我最爱吃火锅'), ['火锅']);
  assert.deepEqual(extractPreferences('我喜欢猫也喜欢狗'), ['猫', '狗']);
});

test('extractPreferences drops pronouns and particles', () => {
  assert.deepEqual(extractPreferences('我喜欢你'), []);
  assert.deepEqual(extractPreferences('我喜欢他'), []);
});

test('extractTopics still returns Chinese and ascii topics', () => {
  const topics = extractTopics('聊聊原神 gaming');
  assert.ok(topics.includes('gaming'));
  assert.ok(topics.some((item) => /[一-龥]/.test(item)));
});

