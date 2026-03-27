import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';
import { GroupAutomationRule } from './models.js';
import { stripCqCodes } from './utils.js';

function buildRuleId() {
  return crypto.randomUUID();
}

function asDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeGroupId(groupId) {
  return String(groupId || '').trim();
}

function normalizePattern(value) {
  return String(value || '').trim();
}

function getRuleModel(deps = {}) {
  return deps.GroupAutomationRule || GroupAutomationRule;
}

function eventText(event) {
  return stripCqCodes(String(event?.rawText || event?.text || ''));
}

function safeRule(rule) {
  return typeof rule?.toObject === 'function' ? rule.toObject() : rule;
}

function isAdminUser(userId) {
  return String(userId || '') === String(config.adminQq || '');
}

export async function createGroupRule(input, deps = {}) {
  const payload = {
    ruleId: input.ruleId || buildRuleId(),
    groupId: normalizeGroupId(input.groupId),
    ruleType: String(input.ruleType || '').trim(),
    label: String(input.label || '').trim(),
    enabled: input.enabled !== false,
    pattern: normalizePattern(input.pattern),
    config: input.config || {},
    createdBy: String(input.createdBy || ''),
  };

  if (Array.isArray(deps.rules)) {
    const existing = payload.ruleType === 'keyword_watch' && payload.pattern
      ? deps.rules.find((rule) => normalizeGroupId(rule.groupId) === payload.groupId
        && rule.ruleType === payload.ruleType
        && normalizePattern(rule.pattern) === payload.pattern
        && rule.enabled !== false)
      : null;
    if (existing) {
      return { ...existing };
    }
    deps.rules.push({ ...payload, createdAt: new Date(), updatedAt: new Date() });
    return { ...deps.rules[deps.rules.length - 1] };
  }

  const model = getRuleModel(deps);
  const existing = payload.ruleType === 'keyword_watch' && payload.pattern
    ? await model.findOne({ groupId: payload.groupId, ruleType: payload.ruleType, pattern: payload.pattern, enabled: true })
    : null;
  if (existing) {
    return safeRule(existing);
  }

  const created = await model.create(payload);
  return safeRule(created);
}

export async function listGroupRules(groupId, filters = {}, deps = {}) {
  if (Array.isArray(deps.rules)) {
    return deps.rules.filter((rule) => {
      if (normalizeGroupId(rule.groupId) !== normalizeGroupId(groupId)) return false;
      if (filters.ruleType && rule.ruleType !== filters.ruleType) return false;
      if (filters.enabled !== undefined && Boolean(rule.enabled) !== Boolean(filters.enabled)) return false;
      return true;
    }).map((rule) => ({ ...rule }));
  }

  const model = getRuleModel(deps);
  const query = { groupId: normalizeGroupId(groupId) };
  if (filters.ruleType) query.ruleType = filters.ruleType;
  if (filters.enabled !== undefined) query.enabled = filters.enabled;
  const rules = await model.find(query).sort({ createdAt: -1 });
  return rules.map(safeRule);
}

export async function removeGroupRule(ruleId, deps = {}) {
  if (Array.isArray(deps.rules)) {
    const index = deps.rules.findIndex((rule) => rule.ruleId === ruleId);
    if (index < 0) {
      return null;
    }
    const [removed] = deps.rules.splice(index, 1);
    return removed;
  }

  const model = getRuleModel(deps);
  const removed = await model.findOneAndDelete({ ruleId: String(ruleId || '') });
  return removed ? safeRule(removed) : null;
}

export async function markRuleTriggered(ruleId, now = new Date(), deps = {}) {
  if (Array.isArray(deps.rules)) {
    const rule = deps.rules.find((item) => item.ruleId === ruleId);
    if (!rule) return null;
    rule.lastTriggeredAt = now;
    rule.updatedAt = now;
    return { ...rule };
  }

  const model = getRuleModel(deps);
  const updated = await model.findOneAndUpdate(
    { ruleId: String(ruleId || '') },
    { $set: { lastTriggeredAt: now } },
    { returnDocument: 'after' }
  );
  return updated ? safeRule(updated) : null;
}

function isWithinHourRange(now, startHour, endHour) {
  const hour = asDate(now).getHours();
  if (startHour === endHour) {
    return true;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function isWithinQuietHours(groupId, now = new Date(), rules = []) {
  for (const rule of rules) {
    if (normalizeGroupId(rule.groupId) !== normalizeGroupId(groupId)) continue;
    if (!rule.enabled || rule.ruleType !== 'quiet_hours') continue;
    const startHour = Number(rule.config?.startHour ?? 0);
    const endHour = Number(rule.config?.endHour ?? 0);
    if (isWithinHourRange(now, startHour, endHour)) {
      return true;
    }
  }
  return false;
}

export async function findMatchingGroupRules(event, deps = {}) {
  const groupId = normalizeGroupId(event?.chatId);
  if (!groupId) {
    return [];
  }

  const rules = await listGroupRules(groupId, { enabled: true }, deps);
  const text = eventText(event).toLowerCase();
  const matches = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.ruleType === 'keyword_watch') {
      const pattern = normalizePattern(rule.pattern).toLowerCase();
      if (pattern && text.includes(pattern)) {
        matches.push(rule);
      }
      continue;
    }

    if (rule.ruleType === 'blocked_user') {
      const blockedUserId = String(rule.config?.userId || rule.pattern || '').trim();
      if (blockedUserId && blockedUserId === String(event.userId || '').trim()) {
        matches.push(rule);
      }
      continue;
    }

    if (rule.ruleType === 'welcome') {
      if (event.source?.noticeType === 'group_increase') {
        matches.push(rule);
      }
      continue;
    }

    if (rule.ruleType === 'quiet_hours' && isWithinQuietHours(groupId, event.timestamp, [rule])) {
      matches.push(rule);
    }
  }

  return matches;
}

export async function evaluateGroupAutomation(event, deps = {}) {
  if (!event || event.chatType !== 'group') {
    return {
      suppressNormalReply: false,
      toolResults: [],
      matchedRules: [],
    };
  }

  const matches = await findMatchingGroupRules(event, deps);
  const toolResults = [];
  let suppressNormalReply = false;

  for (const rule of matches) {
    await markRuleTriggered(rule.ruleId, asDate(event.timestamp), deps);
    recordWorkflowMetric('yuno_automation_rules_triggered_total', 1, {
      group_id: String(event.chatId),
      rule_type: rule.ruleType,
    });

    if (rule.ruleType === 'blocked_user') {
      suppressNormalReply = true;
      continue;
    }

    if (rule.ruleType === 'keyword_watch') {
      toolResults.push({
        tool: 'automation_keyword_alert',
        payload: {
          keyword: rule.pattern,
          username: event.userName,
          userId: event.userId,
          groupId: event.chatId,
          summary: eventText(event).slice(0, 120),
        },
        summary: `${event.userName || event.userId} mentioned ${rule.pattern}.`,
        priority: 'high',
        visibility: 'group',
        followUpHint: 'Use /watch list to inspect current watches.',
        safetyFlags: [],
      });
      continue;
    }

    if (rule.ruleType === 'welcome' && event.source?.noticeType === 'group_increase') {
      toolResults.push({
        tool: 'automation_welcome',
        payload: {
          username: event.userName,
          userId: event.userId,
          groupId: event.chatId,
          customMessage: String(rule.config?.message || '').trim(),
        },
        summary: `${event.userName || event.userId} joined the group.`,
        priority: 'normal',
        visibility: 'group',
        followUpHint: '',
        safetyFlags: [],
      });
    }
  }

  logger.info('automation', 'Evaluated group automation', {
    groupId: event.chatId,
    userId: event.userId,
    matchedRules: matches.map((rule) => rule.ruleType),
    suppressNormalReply,
  });

  return {
    suppressNormalReply,
    toolResults,
    matchedRules: matches,
    isAdmin: isAdminUser(event.userId),
  };
}
