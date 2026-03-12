import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const NAPCAT = process.env.NAPCAT_API;
const TOKEN  = process.env.NAPCAT_TOKEN;

const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

export async function sendText(groupId, text) {
  await axios.post(`${NAPCAT}/send_group_msg`, {
    group_id: Number(groupId),
    message: [{ type: 'text', data: { text } }],
  }, { headers });
}

export async function sendVoice(groupId, mp3Buffer) {
  try {
    const { encode } = await import('silk-sdk');
    const silkBuffer = await encode(mp3Buffer, { targetBitrate: 24000 });
    await axios.post(`${NAPCAT}/send_group_msg`, {
      group_id: Number(groupId),
      message: [{
        type: 'record',
        data: { file: `base64://${silkBuffer.toString('base64')}` },
      }],
    }, { headers });
  } catch (e) {
    console.error('语音转码失败，跳过语音:', e.message);
  }
}