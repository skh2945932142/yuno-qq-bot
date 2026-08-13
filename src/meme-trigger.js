// 玩梗信号的唯一词表。此前 meme-reply-planner、reply-intent-plan 和这里各有一份互不相同的
// 清单：抽象/逆天 只能触发“玩梗接话”子意图，典/急了/草/离谱/嘴硬 只能触发发图，哈哈/破防
// 三处都有但边界不同，于是同一句话在三个环节得到三种判断。现在三处共用下面这个函数。
//
// 单字信号（典/乐/草/梗）用前后否定断言排掉常见词，避免“经典”“音乐”“草稿”“梗概”误判。
const PLAYFUL_SIGNAL_REGEX = new RegExp([
  '笑死',
  '笑不活',
  '绷不住',
  '蚌埠住',
  '蚌住',
  '破防',
  '泪目',
  '离谱',
  '逆天',
  '抽象',
  '阴间',
  '好家伙',
  '麻了',
  '整乐了',
  '急了',
  '嘴硬',
  '乐子',
  '哈哈',
  '地铁老人',
  '芜湖',
  '属实',
  '淦',
  '顶不住',
  '(?<![经字词古法宝圣])典(?![型籍雅藏])',
  '(?<![快音娱可极欢])乐(?![器观园团队意于趣])',
  '(?<![除拔割花水海香甘稻杂烟青芳])草(?![莓稿案地皮原书图坪木])',
  '(?<![心血脑])梗(?![概塞阻])',
].join('|'), 'u');

export function hasPlayfulSignal(text = '') {
  return PLAYFUL_SIGNAL_REGEX.test(String(text || ''));
}

export function parseMemeTrigger(text = '') {
  const normalized = String(text || '').trim();

  if (!normalized) {
    return { explicit: false, semiAuto: false, mode: 'none' };
  }

  if (/^\/meme\b/i.test(normalized) || /做成图|表情包/.test(normalized)) {
    return {
      explicit: true,
      semiAuto: true,
      mode: /做成图/.test(normalized) ? 'generate-quote' : 'send-existing',
    };
  }

  if (hasPlayfulSignal(normalized)) {
    return {
      explicit: false,
      semiAuto: true,
      mode: 'send-existing',
    };
  }

  return { explicit: false, semiAuto: false, mode: 'none' };
}
