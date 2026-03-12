import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { chat } from './minimax.js';
import { sendText } from './sender.js';
import {
  ensureGroupState,
  getRecentEvents,
  logSchedulerSkip,
  markProactiveSent,
  planScheduledInteraction,
} from './services/group-state.js';
import { buildScheduledPrompt } from './services/prompt.js';

async function runScheduledInteraction(groupId) {
  try {
    const groupState = await ensureGroupState(groupId);
    const recentEvents = await getRecentEvents(groupId, 3);
    const plan = planScheduledInteraction({
      groupState,
      recentEvents,
      dateContext: new Date(),
    });

    if (!plan.shouldSend) {
      logSchedulerSkip(plan.reason);
      return;
    }

    const text = await chat([], buildScheduledPrompt({ groupState, recentEvents, plan }));
    await sendText(groupId, text);
    await markProactiveSent(groupId);
    logger.info('scheduler', 'Proactive group message sent', { groupId, topic: plan.topic, tone: plan.tone });
  } catch (error) {
    logger.error('scheduler', 'Scheduled interaction failed', { message: error.message });
  }
}

export function startScheduler() {
  if (!config.targetGroupId) {
    logger.info('scheduler', 'Scheduler disabled because TARGET_GROUP_ID is not set');
    return;
  }

  cron.schedule('0 20 * * *', () => {
    const delay = Math.floor(Math.random() * 90 * 60 * 1000);
    setTimeout(() => {
      runScheduledInteraction(config.targetGroupId);
    }, delay);
  }, { timezone: 'Asia/Shanghai' });

  logger.info('scheduler', 'Scheduler started', { groupId: config.targetGroupId });
}

export { runScheduledInteraction };
