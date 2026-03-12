import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const client = new OpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: 'https://api.siliconflow.cn/v1',
});

// 对话接口
export async function chat(messages, systemPrompt) {
  const res = await client.chat.completions.create({
    model: 'Pro/MiniMax/MiniMax-Text-01',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-20),
    ],
    temperature: 0.9,
    max_tokens: 256,
  });
  return res.choices[0].message.content;
}

// TTS 接口，返回 mp3 Buffer
export async function tts(text) {
  const res = await axios.post(
    'https://api.siliconflow.cn/v1/audio/speech',
    {
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      input: text,
      voice: process.env.YUNO_VOICE_URI,
      response_format: 'mp3',
      speed: 1.0,
    },
    {
      headers: { Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}` },
      responseType: 'arraybuffer',
    }
  );
  return Buffer.from(res.data);
}