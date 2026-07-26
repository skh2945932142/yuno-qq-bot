import { config } from './config.js';
import { clamp } from './utils.js';

const SEGMENT_MIN_TEXT_LENGTH = 36;
const SEGMENT_MIN_PIECE_LENGTH = 6;

function normalizePositiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.round(parsed) : fallback;
}

function joinSentencePieces(left, right) {
  const previous = String(left || '');
  const next = String(right || '');
  const needsSpace = /[A-Za-z0-9.)\]]$/.test(previous) && /^[A-Za-z0-9([{]/.test(next);
  return `${previous}${needsSpace ? ' ' : ''}${next}`;
}

function splitBySentence(text) {
  const value = String(text || '');
  const pieces = [];
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1] || '';
    const chineseBoundary = /[。！？!?…]/.test(character);
    const englishBoundary = character === '.' && (!next || /\s/.test(next));
    if (!chineseBoundary && !englishBoundary) continue;

    const piece = value.slice(start, index + 1).trim();
    if (piece) pieces.push(piece);
    while (index + 1 < value.length && /\s/.test(value[index + 1])) index += 1;
    start = index + 1;
  }

  const remainder = value.slice(start).trim();
  if (remainder) pieces.push(remainder);
  return pieces;
}

export function splitReplyIntoSegments(text, options = {}) {
  const normalized = String(text || '').trim();
  const maxCount = normalizePositiveInteger(
    options.maxCount ?? config.replySegmentMaxCount,
    3
  );

  if (!normalized || maxCount <= 1 || normalized.length < SEGMENT_MIN_TEXT_LENGTH) {
    return normalized ? [normalized] : [];
  }

  // Never split structured-looking content (code, links, lists, headings, quotes, tables).
  if (/```|~~~|`[^`\r\n]+`|https?:\/\/|^\s*(?:[-*+]|\d+[.)]|#{1,6}\s|>\s)|^\s*\|.*\|\s*$/m.test(normalized)) {
    return [normalized];
  }

  const pieces = splitBySentence(normalized);
  if (pieces.length < 2) {
    return [normalized];
  }

  // Merge short pieces forward so no bubble is a lonely fragment.
  const merged = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (last.length < SEGMENT_MIN_PIECE_LENGTH || piece.length < SEGMENT_MIN_PIECE_LENGTH)) {
      merged[merged.length - 1] = joinSentencePieces(last, piece);
      continue;
    }
    merged.push(piece);
  }

  if (merged.length < 2) {
    return [normalized];
  }

  // Collapse down to maxCount by joining the tail.
  while (merged.length > maxCount) {
    const tail = merged.pop();
    merged[merged.length - 1] = joinSentencePieces(merged[merged.length - 1], tail);
  }

  return merged;
}

export function resolveSegmentDelayMs(segmentText, options = {}) {
  const minDelay = normalizePositiveInteger(
    options.minDelayMs ?? config.replySegmentMinDelayMs,
    600,
    0
  );
  const maxDelay = normalizePositiveInteger(
    options.maxDelayMs ?? config.replySegmentMaxDelayMs,
    1400,
    minDelay
  );
  // Longer segments read like longer typing pauses.
  return Math.round(clamp(minDelay + String(segmentText || '').length * 25, minDelay, maxDelay));
}

export function shouldSegmentReply({ event, route, text, runtimeConfig = config } = {}) {
  if (!runtimeConfig.replySegmentationEnabled) return false;
  if (event?.chatType !== 'private') return false;
  if (route?.category === 'knowledge_qa') return false;
  return String(text || '').trim().length >= SEGMENT_MIN_TEXT_LENGTH;
}
