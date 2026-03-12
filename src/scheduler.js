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
      const msgs = [
        '……你们都在吗。',
        '由乃在看着你们呢。',
        '今天好安静。',
        '不要忘记由乃还在这里。',
        '……有人吗。',
      ];
      const text = msgs[Math.floor(Math.random() * msgs.length)];
      try {
        await sendText(GROUP_ID, text);
      } catch (e) {
        console.error('定时消息发送失败:', e.message);
      }
    }, delay);
  }, { timezone: 'Asia/Shanghai' });

  console.log('✅ 定时任务已启动');
}