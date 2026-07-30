import { createSeededRandom } from './reply-cadence.js';

const lastPickByPool = new Map();

const VARIANT_POOLS = Object.freeze({
  'model-fallback-private': [
    { weight: 3, text: '我这边刚才卡了一下，你再发一次，我接着说。' },
    { weight: 2, text: '刚刚信号抖了一拍。你再说一次，我优先接你这条。' },
    { weight: 2, text: '我还在，只是刚才没接上。把刚刚那句重发一下。' },
    { weight: 2, text: '刚才那句没过来。你重发一次，我马上跟上。' },
    { weight: 1, text: '给我半秒，刚刚那下没接稳。你再发一句。' },
  ],
  'model-fallback-group': [
    { weight: 3, text: '我这边刚抖了一下，你再说一次。' },
    { weight: 2, text: '刚刚消息挤住了，重发一句我就接。' },
    { weight: 2, text: '没接上。你再发一次。' },
    { weight: 2, text: '刚那下掉线了，你再来一句。' },
    { weight: 1, text: '等我一下，刚才没跟上这句。' },
  ],
  'model-fallback-knowledge': [
    { weight: 3, text: '刚才查资料卡住了。你把问题再发我一次。' },
    { weight: 2, text: '资料那边没拉回来。重发一次，我优先补全。' },
    { weight: 2, text: '这题我刚查到一半就断了，你再问一次。' },
    { weight: 2, text: '查询那步断了，你再说一次我重新跑。' },
  ],
  'budget-fallback-private': [
    { weight: 3, text: '先说眼前这句。你继续，我下一条补完整一点。' },
    { weight: 2, text: '我先短短接一句，后半段马上跟上。' },
    { weight: 2, text: '先接这一句。剩下的我稍后接着说。' },
    { weight: 2, text: '先给你一句短的，完整的版本我随后补。' },
  ],
  'budget-fallback-group': [
    { weight: 3, text: '先接一句：我在。你继续。' },
    { weight: 2, text: '先短答一下，后半句马上补。' },
    { weight: 2, text: '先这样，剩下的我稍后说。' },
    { weight: 2, text: '先丢一句，详细的等我。' },
  ],
  'budget-fallback-knowledge': [
    { weight: 3, text: '这题先说重点，完整版本我下一条补。' },
    { weight: 2, text: '先一句短答：能接。详细的你再问我。' },
    { weight: 2, text: '先把结论给你，推导部分稍后说。' },
    { weight: 2, text: '先讲主干，细节我后面补。' },
  ],
  'deescalated-support': [
    { weight: 3, text: '先别硬撑。今天可以慢一点。' },
    { weight: 2, text: '不用一下子全做完。先歇一口。' },
    { weight: 2, text: '这件事先放着。你先稳住。' },
    { weight: 2, text: '先把自己摆平，剩下的再说。' },
  ],
  'deescalated-challenge': [
    { weight: 3, text: '我不同意。先把重点说清楚。' },
    { weight: 2, text: '这点我保留。你先把依据摆出来。' },
    { weight: 2, text: '没被说服。把关键那段说清楚。' },
    { weight: 2, text: '我站另一边。先讲你的理由。' },
  ],
  'deescalated-positive': [
    { weight: 3, text: '嗯，听你这么说，我有点高兴。' },
    { weight: 2, text: '这句我记在心里，但不打算表现得太明显。' },
    { weight: 2, text: '行吧，这次就算你说对了。' },
    { weight: 2, text: '听起来不错。我愉快一下就好。' },
  ],
  'deescalated-neutral': [
    { weight: 3, text: '嗯，你继续说。我想听后面。' },
    { weight: 2, text: '说下去，我在听。' },
    { weight: 2, text: '我在。后面那段讲完。' },
    { weight: 2, text: '接着说，别停在这里。' },
  ],
  'tool-ack-reminder': [
    { weight: 3, text: '好，到时间我叫你。' },
    { weight: 2, text: '行，时间到了我提你。' },
    { weight: 2, text: '安排上了，到点我喊你。' },
    { weight: 2, text: '那就这个时间，到了我叫你。' },
  ],
  'tool-ack-subscription': [
    { weight: 3, text: '好，之后我会按这个频率看。' },
    { weight: 2, text: '订阅开始了，有新的我告诉你。' },
    { weight: 2, text: '行，这条线我盯着。' },
    { weight: 2, text: '之后按这个节奏给你。' },
  ],
  'tool-ack-meme': [
    { weight: 3, text: '之后会按这个表情包偏好来。' },
    { weight: 2, text: '行，表情包这边换成这个口味。' },
    { weight: 2, text: '知道你的口味了，之后这么发。' },
    { weight: 2, text: '下次就这个路子的图。' },
  ],
  'tool-ack-preference': [
    { weight: 3, text: '之后会按这个偏好来。' },
    { weight: 2, text: '行，之后就这个调子。' },
    { weight: 2, text: '那就按你这个习惯来。' },
    { weight: 2, text: '以后按这个尺度处理。' },
  ],
  'tool-ack-generic': [
    { weight: 3, text: '好，之后按这个来。' },
    { weight: 2, text: '行，就这么定。' },
    { weight: 2, text: '那就这样办。' },
    { weight: 2, text: '没问题，接下来按这个走。' },
  ],
});

function poolEntries(poolName) {
  const pool = VARIANT_POOLS[poolName];
  return Array.isArray(pool) ? pool.filter((item) => item && item.text) : [];
}

function pickWeighted(entries, random) {
  const total = entries.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (total <= 0) return entries[0]?.text || '';
  let cursor = random() * total;
  for (const entry of entries) {
    cursor -= Math.max(0, Number(entry.weight) || 0);
    if (cursor < 0) return entry.text;
  }
  return entries[entries.length - 1].text;
}

export function pickReplyVariant(poolName, { chatId = '', seed = '', random = null } = {}) {
  const entries = poolEntries(poolName);
  if (entries.length === 0) return '';

  const memoryKey = `${poolName}:${chatId || 'global'}`;
  const previous = lastPickByPool.get(memoryKey) || '';
  const rng = typeof random === 'function'
    ? random
    : createSeededRandom(`${poolName}:${chatId || 'chat'}:${seed || Date.now()}`);

  let picked = pickWeighted(entries, rng);
  if (entries.length > 1 && picked === previous) {
    const alternatives = entries.filter((entry) => entry.text !== previous);
    picked = pickWeighted(alternatives, rng);
  }

  lastPickByPool.set(memoryKey, picked);
  return picked;
}

export function buildModelFallbackVariant({ event = {}, route = null, error = null } = {}) {
  const isPrivate = event.chatType === 'private';
  const poolName = route?.category === 'knowledge_qa'
    ? 'model-fallback-knowledge'
    : isPrivate ? 'model-fallback-private' : 'model-fallback-group';
  return pickReplyVariant(poolName, {
    chatId: event.chatId,
    seed: `${event.messageId || ''}:${String(error?.code || error?.status || 'unknown')}`,
  });
}

export function buildBudgetFallbackVariant({ event = {}, route = null } = {}) {
  const isPrivate = event.chatType === 'private';
  const poolName = route?.category === 'knowledge_qa'
    ? 'budget-fallback-knowledge'
    : isPrivate ? 'budget-fallback-private' : 'budget-fallback-group';
  return pickReplyVariant(poolName, {
    chatId: event.chatId,
    seed: String(event.messageId || ''),
  });
}

export function buildDeescalatedVariant({ event = {}, intent = '', sentiment = '' } = {}) {
  const normalizedIntent = String(intent || '').toLowerCase();
  const normalizedSentiment = String(sentiment || '').toLowerCase();
  const poolName = normalizedIntent === 'help' || normalizedSentiment === 'negative'
    ? 'deescalated-support'
    : normalizedIntent === 'challenge'
      ? 'deescalated-challenge'
      : normalizedSentiment === 'positive'
        ? 'deescalated-positive'
        : 'deescalated-neutral';
  return pickReplyVariant(poolName, {
    chatId: event.chatId,
    seed: String(event.messageId || ''),
  });
}

export function buildToolAcknowledgementVariant({ tool = '', detail = '', chatId = '' } = {}) {
  const normalizedTool = String(tool || '');
  const poolName = normalizedTool.startsWith('reminder_') || normalizedTool === 'schedule_note'
    ? 'tool-ack-reminder'
    : normalizedTool.startsWith('subscription_')
      ? 'tool-ack-subscription'
      : normalizedTool.startsWith('meme_')
        ? 'tool-ack-meme'
        : normalizedTool.startsWith('memory_') || normalizedTool.startsWith('style_')
          ? 'tool-ack-preference'
          : 'tool-ack-generic';
  const base = pickReplyVariant(poolName, { chatId, seed: normalizedTool });
  const normalizedDetail = String(detail || '').trim();
  if (!normalizedDetail) return base;
  return `${base.replace(/[。！]$/, '')}：${normalizedDetail}`;
}

export function resetReplyVariantMemory() {
  lastPickByPool.clear();
}

export { VARIANT_POOLS };
