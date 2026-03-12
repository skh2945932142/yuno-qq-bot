import cron from 'node-cron';
import { sendText } from './sender.js';
import dotenv from 'dotenv';
dotenv.config();

const GROUP_ID = process.env.TARGET_GROUP_ID;

export function startScheduler() {
  if (!GROUP_ID) {
    console.log('⚠️ 未设置 TARGET_GROUP_ID，定时任务跳过');
    return;
  }

  // 每天晚上8点触发，随机延迟0-2小时内发送
  cron.schedule('0 20 * * *', () => {
    const delay = Math.random() * 2 * 60 * 60 * 1000;
    setTimeout(async () => {
      const groupEvents = await GroupEvent.find({ groupId: GROUP_ID }).sort({ createdAt: -1 }).limit(3);
      const text = groupEvents.length > 0 ? `最近群里有事发生：${groupEvents[0].summary}` : '今天好安静，大家聊点什么？';
      try {
        await sendText(GROUP_ID, text);
      } catch (e) {
        console.error('定时消息发送失败:', e.message);
      }
    }, delay);
  }, { timezone: 'Asia/Shanghai' });

  console.log('✅ 定时任务已启动');
}