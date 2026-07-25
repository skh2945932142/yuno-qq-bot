import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';

export async function connectDB(runtimeConfig = config) {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(runtimeConfig.mongodbUri, {
      maxPoolSize: runtimeConfig.mongoMaxPoolSize,
      serverSelectionTimeoutMS: 10000,
    });
    logger.info('db', 'MongoDB connected', { maxPoolSize: runtimeConfig.mongoMaxPoolSize });
    return mongoose.connection;
  } catch (error) {
    logger.error('db', 'MongoDB connection failed', { message: error.message });
    throw error;
  }
}

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('db', 'MongoDB disconnected');
  }
}
