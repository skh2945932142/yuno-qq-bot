import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';

export async function connectDB() {
  try {
    await mongoose.connect(config.mongodbUri, {
      maxPoolSize: config.mongoMaxPoolSize,
      serverSelectionTimeoutMS: 10000,
    });
    logger.info('db', 'MongoDB connected', { maxPoolSize: config.mongoMaxPoolSize });
  } catch (error) {
    logger.error('db', 'MongoDB connection failed', { message: error.message });
    process.exit(1);
  }
}

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}
