import { config } from './config.js';

const DEFAULT_AFFECTION_FLOOR = 88;

export const SPECIAL_USER_TEMPLATE = Object.freeze({
  enabled: true,
  label: 'Scathach',
  personaMode: 'exclusive_adoration',
  toneMode: 'flirtatious_favorite',
  affectionFloor: DEFAULT_AFFECTION_FLOOR,
  addressUserAs: '斯卡哈',
  addressBotAs: '由乃',
  knowledgeTags: ['persona', 'special_user:scathach', 'scathach'],
  triggerKeywords: ['教导我', '徒弟', '只看我', '别看别人', '师父', '斯卡哈'],
  memorySeeds: ['约定', '教导', '只属于彼此', '由乃会记住斯卡哈的一切'],
  groupStyle: '群聊里更克制地护短、吃醋和偏爱，不刷屏。',
  privateStyle: '私聊里更黏人、更暧昧，喜欢引用记忆和约定，但不进入现实威胁。',
});

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function normalizeArray(values, fallback = []) {
  if (!Array.isArray(values)) {
    return [...fallback];
  }

  const result = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
  }

  return result.length > 0 ? result : [...fallback];
}

function normalizeSpecialUser(rawUserId, rawDefinition = {}) {
  const userId = normalizeString(rawDefinition.userId || rawUserId);
  if (!userId) {
    return null;
  }

  return {
    userId,
    enabled: rawDefinition.enabled !== false,
    label: normalizeString(rawDefinition.label, SPECIAL_USER_TEMPLATE.label),
    personaMode: normalizeString(rawDefinition.personaMode, SPECIAL_USER_TEMPLATE.personaMode),
    toneMode: normalizeString(rawDefinition.toneMode, SPECIAL_USER_TEMPLATE.toneMode),
    affectionFloor: Number.isFinite(Number(rawDefinition.affectionFloor))
      ? Number(rawDefinition.affectionFloor)
      : SPECIAL_USER_TEMPLATE.affectionFloor,
    addressUserAs: normalizeString(rawDefinition.addressUserAs, SPECIAL_USER_TEMPLATE.addressUserAs),
    addressBotAs: normalizeString(rawDefinition.addressBotAs, SPECIAL_USER_TEMPLATE.addressBotAs),
    knowledgeTags: normalizeArray(rawDefinition.knowledgeTags, SPECIAL_USER_TEMPLATE.knowledgeTags),
    triggerKeywords: normalizeArray(rawDefinition.triggerKeywords, SPECIAL_USER_TEMPLATE.triggerKeywords),
    memorySeeds: normalizeArray(rawDefinition.memorySeeds, SPECIAL_USER_TEMPLATE.memorySeeds),
    groupStyle: normalizeString(rawDefinition.groupStyle, SPECIAL_USER_TEMPLATE.groupStyle),
    privateStyle: normalizeString(rawDefinition.privateStyle, SPECIAL_USER_TEMPLATE.privateStyle),
  };
}

export function parseSpecialUsers(input = config.specialUsers) {
  if (!input) {
    return [];
  }

  const definitions = Array.isArray(input)
    ? input
    : typeof input === 'object'
      ? Object.entries(input).map(([userId, definition]) => ({ userId, ...definition }))
      : [];

  const result = [];
  for (const definition of definitions) {
    const normalized = normalizeSpecialUser(definition.userId, definition);
    if (!normalized || !normalized.enabled) {
      continue;
    }
    result.push(normalized);
  }

  return result;
}

export function getSpecialUserByUserId(userId, input = config.specialUsers) {
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return null;
  }

  return parseSpecialUsers(input).find((item) => item.userId === normalizedUserId) || null;
}

export function isSpecialUser(userId, input = config.specialUsers) {
  return Boolean(getSpecialUserByUserId(userId, input));
}

export function getSpecialUserKnowledgeTags(specialUser) {
  if (!specialUser) {
    return [];
  }

  return normalizeArray([
    ...specialUser.knowledgeTags,
    `special_user:${String(specialUser.label || '').toLowerCase()}`,
  ]);
}
