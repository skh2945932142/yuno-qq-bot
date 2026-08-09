function stripCqCodes(text) {
  return String(text || '').replace(/\[CQ:[^\]]+\]/g, '');
}

/**
 * Commands and poke events do not need expensive memory/group context before a
 * deterministic policy response can be produced.
 */
export function shouldUseLightweightReplyContext(event, analysis = null) {
  if (analysis?.reason === 'poke-trigger' || analysis?.reason === 'command-trigger') {
    return true;
  }
  const text = stripCqCodes(event?.rawText || event?.text || '');
  return event?.source?.postType === 'message' && /^\/\S+/.test(text);
}
