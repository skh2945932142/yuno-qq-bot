export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

const hourFormatterCache = new Map();

function getHourFormatter(timeZone) {
  const requestedTimeZone = String(timeZone || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
  if (hourFormatterCache.has(requestedTimeZone)) {
    return hourFormatterCache.get(requestedTimeZone);
  }

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: requestedTimeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: DEFAULT_TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    });
  }

  hourFormatterCache.set(requestedTimeZone, formatter);
  return formatter;
}

export function getHourInTimeZone(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Number.NaN;
  }

  const hourPart = getHourFormatter(timeZone)
    .formatToParts(date)
    .find((part) => part.type === 'hour');
  const hour = Number(hourPart?.value);
  return Number.isInteger(hour) ? hour : Number.NaN;
}

const clockFormatterCache = new Map();

function getClockFormatter(timeZone) {
  const requestedTimeZone = String(timeZone || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
  if (clockFormatterCache.has(requestedTimeZone)) {
    return clockFormatterCache.get(requestedTimeZone);
  }

  const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: requestedTimeZone, ...options });
  } catch {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_TIME_ZONE, ...options });
  }

  clockFormatterCache.set(requestedTimeZone, formatter);
  return formatter;
}

export function formatClockInTimeZone(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return getClockFormatter(timeZone).format(date);
}

export const WINDOW_MIN_HOURS = 0.25;
export const WINDOW_MAX_HOURS = 168;
export const DEFAULT_WINDOW_HOURS = 24;
const WINDOW_TOKEN_REGEX = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|分钟|分|h|hr|hrs|hour|hours|小时|时|d|day|days|天)?$/;
const MINUTE_UNIT_REGEX = /^(m|min|mins|minute|minutes|分钟|分)$/;
const DAY_UNIT_REGEX = /^(d|day|days|天)$/;

export function resolveWindowHours(value, fallback = DEFAULT_WINDOW_HOURS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(WINDOW_MAX_HOURS, Math.max(WINDOW_MIN_HOURS, parsed));
}

// Accepts the shapes a user actually types: "2h", "30m", "3d" or a bare hour count.
// An unparseable token falls back instead of reaching the query, which previously
// accepted "100000" or let Number('2h') through as NaN.
export function parseWindowArgument(token, fallback = DEFAULT_WINDOW_HOURS) {
  const raw = String(token ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const match = raw.match(WINDOW_TOKEN_REGEX);
  if (!match) return fallback;

  const amount = Number(match[1]);
  const unit = match[2] || 'h';
  const hours = MINUTE_UNIT_REGEX.test(unit)
    ? amount / 60
    : DAY_UNIT_REGEX.test(unit)
      ? amount * 24
      : amount;
  return resolveWindowHours(hours, fallback);
}

export function formatWindowLabel(windowHours) {
  const hours = resolveWindowHours(windowHours);
  if (hours < 1) return `${Math.round(hours * 60)} 分钟`;
  // 24 stays "24 小时": the default report reads better that way than as "1 天".
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} 天`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
}
