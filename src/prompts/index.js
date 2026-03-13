export { buildReplyContext, buildScheduledPrompt } from '../services/prompt.js';

export const PROMPT_VERSIONS = Object.freeze({
  reply: 'reply-context/v2',
  scheduled: 'scheduled-message/v1',
  analysis: 'message-analysis/v1',
});
