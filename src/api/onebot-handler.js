import { logger } from '../logger.js';
import { validateGroupMessageEvent } from '../schemas/group-message-event.js';
import { processGroupMessage, shouldRespondToEvent } from '../workflows/group-message-workflow.js';

export async function handleOnebotWebhook(req, res) {
  res.send();

  const validation = validateGroupMessageEvent(req.body);
  if (!validation.ok) {
    logger.info('webhook', 'Ignored unsupported webhook payload', {
      errors: validation.errors,
    });
    return;
  }

  const event = validation.value;

  try {
    const decision = await shouldRespondToEvent(event);
    if (!decision.analysis.shouldRespond) {
      return;
    }

    await processGroupMessage(event, decision);
  } catch (error) {
    logger.error('webhook', 'Failed to process incoming message', {
      message: error.message,
    });
  }
  const event1 = validation.value;
console.log('raw_message:', JSON.stringify(event.raw_message)); // 加这行
}
