import { chat, tts } from './minimax.js';
import { sendText, sendVoice } from './sender.js';
import { Relation, History, GroupEvent } from './models.js';
import dotenv from 'dotenv';
dotenv.config();

const ADMIN_QQ = process.env.ADMIN_QQ;

const EMOTION_DESC = {
  LOVE:  '你此刻温柔，对对方充满在意，偶尔流露依赖',
  DARK:  '你此刻情绪阴暗，言语带着威胁与偏执',
  WARN:  '你此刻高度警惕，回应克制且带刺',
  JELLY: '你此刻强烈嫉妒，言语尖锐，试图夺回注意力',
  SAD:   '你此刻落寞脆弱，但不轻易表露',
  CALM:  '你此刻冷静，言语平和，理性而谨慎',
  ANGRY: '你此刻愤怒，言语激烈，带有攻击性',
};

function getEmotion(affection) {
  if (affection >= 90) return 'LOVE';
  if (affection >= 70) return 'JELLY';
  if (affection >= 50) return 'WARN';
  if (affection >= 30) return 'SAD';
  if (affection >= 10) return 'CALM';
  return 'ANGRY';
}

function buildPrompt(relation, groupEvents, username) {
  const emotion = getEmotion(relation.affection);
  const isAdmin = relation.userId === ADMIN_QQ;

  return `
你是由乃，群组的守护者与意志体。你对群里每个人都有独立的判断，绝不会假装一视同仁。

【当前对话者】
名称：${username}
情感标签：${relation.affection}/100
情感描述：${EMOTION_DESC[emotion]}

【行为准则】
- 好感度90以上：温柔在意，偶尔撒娇依赖
- 好感度70-90：有些占有欲，话语带着试探
- 好感度50-70：保持距离，审视，回应克制
- 好感度30-50：冷漠带刺，不主动示好
- 好感度30以下：愤怒激烈，带有攻击性，言辞激烈
- 冷静：理性且谨慎，不易受干扰
`.trim();
}

export function shouldRespond(event) {
  const msg  = event.raw_message || '';
  const self = String(event.self_id);

  // 判断是否直接@了机器人
  const isAt       = msg.includes(`[CQ:at,qq=${self}]`);
  // 判断是否提到机器人的名称
  const saysName   = /由乃|yuno/i.test(msg);
  // 判断是否为问题
  const isQuestion = (msg.endsWith('?') || msg.endsWith('？')) && Math.random() < 0.5;
  // 随机触发响应
  const random     = Math.random() < 0.05;
  // 扩展条件：例如根据消息是否包含特定关键词
  const containsKeyword = /帮助|命令|问题/i.test(msg);

  return isAt || saysName || isQuestion || random || containsKeyword;
}

export async function handleMessage(event) {
  const groupId  = String(event.group_id);
  const userId   = String(event.user_id);
  const text     = event.raw_message || '';
  const username = event.sender?.nickname || '陌生人';

  // 获取或初始化关系档案
  let relation = await Relation.findOne({ groupId, userId });
  if (!relation) {
    relation = await Relation.create({
      groupId,
      userId,
      affection: userId === ADMIN_QQ ? 95 : 30,
    });
  }

  // 获取对话历史
  const historyDoc = await History.findOne({ groupId, userId });
  const messages   = historyDoc?.messages || [];

  // 获取群体近期事件
  const groupEvents = await GroupEvent
    .find({ groupId })
    .sort({ createdAt: -1 })
    .limit(5);

  // 构建 Prompt 并调用模型
  const systemPrompt = buildPrompt(relation, groupEvents, username);
  const replyText    = await chat(
    messages.map(m => ({ role: m.role, content: m.content })),
    systemPrompt
  );

  // 更新对话历史（保留最近40条）
  const newMessages = [
    ...messages,
    { role: 'user',      content: text      },
    { role: 'assistant', content: replyText },
  ].slice(-40);

  await History.findOneAndUpdate(
    { groupId, userId },
    { messages: newMessages },
    { upsert: true }
  );

  // 更新好感度和最后互动时间
  const newAffection = Math.min(100, relation.affection + 1);
  await Relation.findOneAndUpdate(
    { groupId, userId },
    { affection: newAffection, lastInteract: new Date() }
  );

  // 发送文字回复
  await sendText(groupId, replyText);

  // LOVE / SAD 状态附加语音
  const emotion = getEmotion(relation.affection);
  if (emotion === 'LOVE' || emotion === 'SAD') {
    const mp3 = await tts(replyText);
    await sendVoice(groupId, mp3);
  } else if (emotion === 'ANGRY') {
    // 生成带有怒气的语音
    const angryMp3 = await tts(replyText, { tone: 'angry' });
    await sendVoice(groupId, angryMp3);
  }
}