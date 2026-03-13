import { logger } from '../logger.js';
import { validateGroupMessageEvent } from '../schemas/group-message-event.js';
import { processGroupMessage, shouldRespondToEvent } from '../workflows/group-message-workflow.js';

export async function handleOnebotWebhook(req, res) {
  res.send('OK');

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
}
