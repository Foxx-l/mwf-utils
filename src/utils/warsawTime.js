// @ts-check
/**
 * warsawTime.js — Single source of truth for Europe/Warsaw wall-clock ↔
 * Unix-timestamp conversion.
 *
 * Every feature that renders `<t:…>` timestamps or schedules Warsaw-time
 * jobs goes through this module. All math uses the IANA time-zone database
 * via Intl, so DST transitions are handled automatically — there are no
 * hardcoded UTC offsets anywhere.
 */

const TIME_ZONE = 'Europe/Warsaw';

const WEEKDAY_NUMBERS = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

const partFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

/**
 * Decomposes an instant into Warsaw wall-clock parts.
 * Returns `{ year, month (0-11), day, hour, minute, weekday (0=Sun) }`.
 */
function warsawDateParts(date = new Date()) {
  const parts = partFormatter.formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')) - 1, // 0-11, matches Date#getUTCMonth
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAY_NUMBERS[get('weekday')] ?? 0,
  };
}

/** Warsaw-minus-UTC offset in whole minutes at the given UTC instant. */
function offsetMinutesAt(utcMs) {
  const floored = Math.floor(utcMs / 60000) * 60000; // drop seconds so the diff is exact
  const local = warsawDateParts(new Date(floored));
  const asUtc = Date.UTC(local.year, local.month, local.day, local.hour, local.minute);
  return Math.round((asUtc - floored) / 60000);
}

/**
 * Unix seconds for a Warsaw wall-clock time.
 * `month` is 0-11 (Date convention). Hours/minutes are Warsaw-local.
 *
 * Around DST transitions the offset at the naive guess can differ from the
 * offset at the true instant, so the offset is verified twice. Non-existent
 * local times (spring-forward gap) resolve forward, which is the standard
 * behaviour and irrelevant for this bot's evening event slots.
 */
function warsawToUnix(year, month, day, hour, minute = 0) {
  const wallAsUtcMs = Date.UTC(year, month, day, hour, minute);
  const offset = offsetMinutesAt(wallAsUtcMs);
  let utcMs = wallAsUtcMs - offset * 60000;
  const actual = offsetMinutesAt(utcMs);
  if (actual !== offset) utcMs = wallAsUtcMs - actual * 60000;
  return Math.floor(utcMs / 1000);
}

/** Convenience wrapper accepting a 24-hour `HH:MM` string. */
function warsawTimeToUnix(year, month, day, time) {
  const [hour, minute] = String(time || '0:0').split(':').map(Number);
  return warsawToUnix(year, month, day, hour || 0, minute || 0);
}

module.exports = { TIME_ZONE, warsawDateParts, warsawToUnix, warsawTimeToUnix };
