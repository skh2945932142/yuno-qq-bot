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
