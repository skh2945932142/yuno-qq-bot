import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectMemeByWeight, selectScoredMemeByWeight } from '../src/meme-selector.js';

test('selectMemeByWeight returns null for empty candidates', () => {
  const result = selectMemeByWeight([]);
  assert.equal(result, null);
});

test('selectMemeByWeight returns single candidate directly', () => {
  const candidate = { assetId: 'test1', usageCount: 5 };
  const result = selectMemeByWeight([candidate]);
  assert.equal(result, candidate);
});

test('selectMemeByWeight uses weight-based random selection for multiple candidates', () => {
  const candidates = [
    { assetId: 'meme1', usageCount: 0, lastUsedAt: null },
    { assetId: 'meme2', usageCount: 10, lastUsedAt: null },
    { assetId: 'meme3', usageCount: 5, lastUsedAt: null },
  ];
  
  // 运行多次确保有随机性
  const selections = new Set();
  for (let i = 0; i < 50; i++) {
    const selected = selectMemeByWeight(candidates);
    assert.ok(selected, 'Should select a candidate');
    assert.ok(candidates.includes(selected), 'Selected should be from candidates');
    selections.add(selected.assetId);
  }
  
  // 应该选择了多个不同的表情包（不是总选同一个）
  assert.ok(selections.size > 1, `Should select multiple different memes, got ${selections.size} unique selections`);
});

test('selectMemeByWeight considers position weight', () => {
  const candidates = [
    { assetId: 'first', usageCount: 0, lastUsedAt: null },
    { assetId: 'second', usageCount: 0, lastUsedAt: null },
    { assetId: 'third', usageCount: 0, lastUsedAt: null },
  ];
  
  // 第一个位置应该有更高概率被选中（但不是100%）
  const selections = {};
  for (let i = 0; i < 100; i++) {
    const selected = selectMemeByWeight(candidates);
    selections[selected.assetId] = (selections[selected.assetId] || 0) + 1;
  }
  
  // 第一个应该被选中最多次
  assert.ok(selections.first > selections.third, 'First position should have higher selection rate');
});

test('selectMemeByWeight penalizes recently used memes', () => {
  const nowMs = Date.now();
  const candidates = [
    { assetId: 'recent', usageCount: 0, lastUsedAt: new Date(nowMs - 30 * 60 * 1000) }, // 30分钟前
    { assetId: 'old', usageCount: 0, lastUsedAt: new Date(nowMs - 48 * 60 * 60 * 1000) }, // 48小时前
  ];
  
  const selections = {};
  for (let i = 0; i < 100; i++) {
    const selected = selectMemeByWeight(candidates, { nowMs });
    selections[selected.assetId] = (selections[selected.assetId] || 0) + 1;
  }
  
  // 旧的表情包应该被选中更多次
  assert.ok(selections.old > selections.recent, 'Old meme should be selected more often than recent one');
});

test('selectScoredMemeByWeight returns null for empty candidates', () => {
  const result = selectScoredMemeByWeight([]);
  assert.equal(result, null);
});

test('selectScoredMemeByWeight returns single candidate directly', () => {
  const candidate = { asset: { assetId: 'test1' }, score: 0.85 };
  const result = selectScoredMemeByWeight([candidate]);
  assert.deepEqual(result, candidate);
});

test('selectScoredMemeByWeight uses score as weight base', () => {
  const candidates = [
    { asset: { assetId: 'high' }, score: 0.95 },
    { asset: { assetId: 'medium' }, score: 0.75 },
    { asset: { assetId: 'low' }, score: 0.55 },
  ];
  
  const selections = {};
  for (let i = 0; i < 100; i++) {
    const selected = selectScoredMemeByWeight(candidates);
    selections[selected.asset.assetId] = (selections[selected.asset.assetId] || 0) + 1;
  }
  
  // 高分表情包应该被选中最多
  assert.ok(selections.high > selections.low, 'High score should be selected more often than low score');
  // 但低分也应该有被选中的机会（随机性）
  assert.ok(selections.low > 0, 'Low score should still have chances to be selected');
});

test('selectScoredMemeByWeight introduces randomness', () => {
  const candidates = [
    { asset: { assetId: 'a' }, score: 0.8 },
    { asset: { assetId: 'b' }, score: 0.8 },
    { asset: { assetId: 'c' }, score: 0.8 },
  ];
  
  const selections = new Set();
  for (let i = 0; i < 30; i++) {
    const selected = selectScoredMemeByWeight(candidates);
    selections.add(selected.asset.assetId);
  }
  
  // 相同分数应该有不同的选择结果
  assert.ok(selections.size > 1, 'Should select different memes with same scores');
});
