/**
 * 基于权重的随机选择算法
 * @param {Array} candidates - 候选表情包列表
 * @param {Object} context - 上下文信息（用于计算权重）
 * @returns {Object|null} - 选中的表情包
 */
export function selectMemeByWeight(candidates = [], context = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  // 只有一个候选时直接返回
  if (candidates.length === 1) {
    return candidates[0];
  }

  // 计算每个候选的权重
  const weighted = candidates.map((candidate, index) => {
    const weight = calculateMemeWeight(candidate, index, context);
    return { candidate, weight };
  });

  // 权重求和
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  
  // 随机选择
  const random = Math.random() * totalWeight;
  let cumulative = 0;
  
  for (const item of weighted) {
    cumulative += item.weight;
    if (random <= cumulative) {
      return item.candidate;
    }
  }

  // 兜底：返回第一个
  return weighted[0].candidate;
}

/**
 * 计算单个表情包的权重分数
 * @param {Object} candidate - 候选表情包
 * @param {number} index - 在列表中的位置
 * @param {Object} context - 上下文信息
 * @returns {number} - 权重分数（>0）
 */
function calculateMemeWeight(candidate, index, context = {}) {
  let weight = 100; // 基础权重

  // 1. 位置权重：越靠前权重越高（但不会完全主导）
  const positionBonus = Math.max(0, 50 - index * 5);
  weight += positionBonus;

  // 2. 使用频率：最近使用过的降低权重
  const lastUsedAt = candidate.lastUsedAt ? new Date(candidate.lastUsedAt).getTime() : 0;
  const nowMs = context.nowMs || Date.now();
  const hoursSinceLastUse = (nowMs - lastUsedAt) / (1000 * 60 * 60);
  
  if (hoursSinceLastUse < 1) {
    weight *= 0.3; // 1小时内使用过，大幅降权
  } else if (hoursSinceLastUse < 24) {
    weight *= 0.7; // 24小时内使用过，适度降权
  }

  // 3. 使用总次数：使用过多的略微降权（避免过度重复）
  const usageCount = candidate.usageCount || 0;
  if (usageCount > 50) {
    weight *= 0.8;
  } else if (usageCount > 20) {
    weight *= 0.9;
  }

  // 4. 情绪匹配：如果表情包情绪与当前情绪匹配，增加权重
  const candidateEmotion = String(candidate.emotion || '').toLowerCase();
  const contextEmotion = String(context.emotion || '').toLowerCase();
  if (candidateEmotion && contextEmotion && candidateEmotion === contextEmotion) {
    weight *= 1.5;
  }

  // 5. 随机波动：增加一定随机性，避免完全可预测
  const randomFactor = 0.7 + Math.random() * 0.6; // 0.7-1.3
  weight *= randomFactor;

  return Math.max(1, weight); // 确保权重至少为1
}
/**
 * 基于评分的加权随机选择
 * @param {Array} scoredCandidates - 已评分的候选列表 [{asset, score}, ...]
 * @returns {Object|null} - 选中的候选（包含 asset 和 score）
 */
export function selectScoredMemeByWeight(scoredCandidates = []) {
  if (!Array.isArray(scoredCandidates) || scoredCandidates.length === 0) {
    return null;
  }

  if (scoredCandidates.length === 1) {
    return scoredCandidates[0];
  }

  // 使用 score 作为基础权重，同时考虑位置
  const weighted = scoredCandidates.map((candidate, index) => {
    // 基础权重 = score * 100
    let weight = Math.max(1, candidate.score * 100);
    
    // 位置权重：前几名略有优势，但不会完全主导
    const positionBonus = Math.max(0, 20 - index * 3);
    weight += positionBonus;
    
    // 随机波动：增加不可预测性
    const randomFactor = 0.8 + Math.random() * 0.4; // 0.8-1.2
    weight *= randomFactor;
    
    return { ...candidate, weight };
  });

  // 权重求和
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  
  // 随机选择
  const random = Math.random() * totalWeight;
  let cumulative = 0;
  
  for (const item of weighted) {
    cumulative += item.weight;
    if (random <= cumulative) {
      return { asset: item.asset, score: item.score };
    }
  }

  // 兜底：返回第一个
  return { asset: weighted[0].asset, score: weighted[0].score };
}
