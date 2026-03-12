import express from 'express';
import dotenv from 'dotenv';
import { connectDB } from './db.js';
import { handleMessage, shouldRespond } from './emotion.js';
import { startScheduler } from './scheduler.js';
dotenv.config();

const app = express();
app.use(express.json());

app.post('/onebot', async (req, res) => {
  res.send('OK'); // 立即响应，避免 NapCatQQ 上报超时

  const event = req.body;
  if (event.post_type !== 'message') return;
  if (event.message_type !== 'group') return;
  if (!shouldRespond(event)) return;

  try {
    await handleMessage(event);
  } catch (e) {
    console.error('处理消息出错:', e.message);
  }
});

app.get('/health', (_, res) => res.send('由乃在线 ✅'));

async function main() {
  await connectDB();
  startScheduler();
  app.listen(process.env.PORT || 3000, () => {
    console.log(`🌸 由乃 QQ Bot 已启动，端口 ${process.env.PORT || 3000}`);
  });
}

main();