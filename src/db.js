import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB 已连接');
  } catch (e) {
    console.error('❌ MongoDB 连接失败:', e.message);
    process.exit(1);
  }
}