/**
 * rotationCycle.js — Pure logic for the rolling 2-month map rotation.
 *
 * The rotation embed always shows exactly two consecutive months. Every
 * Wednesday inside each month has one map scheduled, taken from a fixed
 * cycle of 5 maps that loops continuously across months:
 *
 *   Utah → SMDM → Omaha → Carentan → SME → Utah → ...
 *
 * When the current month has fully elapsed (or an admin clicks "Advance"),
 * the second month scrolls to the top and a fresh month is generated below
 * it, continuing the cycle where it left off.
 *
 * Event times default to the same day-of-week and hour as the most recent
 * event in the current embed. When the embed is empty we fall back to
 * Wednesday 20:00 Europe/Warsaw.
 */

const MAP_CYCLE = ['Utah', 'SMDM', 'Omaha', 'Carentan', 'SME'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DEFAULT_WEEKDAY = 3;  // Wednesday
const DEFAULT_HOUR    = 20; // 20:00 Warsaw
const DEFAULT_MINUTE  = 0;

function getWarsawOffsetHours(date) {
  const utcMs    = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const warsawMs = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' })).getTime();
  return Math.round((warsawMs - utcMs) / 3_600_000);
}

/**
 * Returns the Unix timestamp (seconds) for Year/Month/Day at the given
 * Warsaw-local hour:minute, correctly handling DST transitions.
 */
function warsawToUnix(year, month /* 0-11 */, day, hour, minute) {
  const probe       = new Date(Date.UTC(year, month, day, hour, minute, 0));
  const offsetHours = getWarsawOffsetHours(probe);
  const utcHour     = hour - offsetHours;
  return Math.floor(Date.UTC(year, month, day, utcHour, minute, 0) / 1000);
}

/**
 * Parses a rendered embed event line like "<t:1700000000:f> - **Utah**"
 * and returns { unix, map }. Returns null for lines that don't match.
 */
function parseEventLine(line) {
  if (!line) return null;
  const m = line.trim().match(/^<t:(\d+):[a-zA-Z]>\s*-\s*\*\*\s*(.+?)\s*\*\*\s*$/);
  if (!m) return null;
  const [, unixStr, rawMap] = m;
  return {
    unix: parseInt(unixStr, 10),
    map:  rawMap.replace(/`/g, '').trim()
  };
}

function parseEventBlock(text) {
  if (!text) return [];
  return text.split('\n').map(parseEventLine).filter(Boolean);
}

/**
 * Given any map name written by the admin ("utah", "sm-dm", "SME"), return
 * the canonical cycle entry or null if no match.
 */
function matchCycleMap(name) {
  if (!name) return null;
  const norm = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const candidate of MAP_CYCLE) {
    if (candidate.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) {
      return candidate;
    }
  }
  return null;
}

function nextMapAfter(mapName) {
  const canonical = matchCycleMap(mapName);
  if (!canonical) return MAP_CYCLE[0];
  const idx = MAP_CYCLE.indexOf(canonical);
  return MAP_CYCLE[(idx + 1) % MAP_CYCLE.length];
}

/**
 * All occurrences of `weekday` in the given calendar month, returned as
 * day-of-month numbers (1-based) in ascending order.
 */
function weekdaysInMonth(year, month /* 0-11 */, weekday /* 0=Sun, 3=Wed */) {
  const days = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month, d).getDay() === weekday) days.push(d);
  }
  return days;
}

function monthHeader(year, month /* 0-11 */) {
  return `${MONTH_NAMES[month]} ${year}`;
}

function parseMonthHeader(header) {
  if (!header) return null;
  const m = header.trim().match(/^(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const [, rawMonth, rawYear] = m;
  const monthIdx = MONTH_NAMES.findIndex(
    n => n.toLowerCase() === rawMonth.toLowerCase()
  );
  if (monthIdx === -1) return null;
  return { year: parseInt(rawYear, 10), month: monthIdx };
}

/**
 * Looks at a data object ({ month1Header, month1Events, month2Header,
 * month2Events }) and returns:
 *   { lastMap, weekday, hour, minute }
 * for the most recent scheduled event across both months. Falls back to
 * Utah / Wednesday / 20:00 Warsaw when the embed has no parseable events.
 */
function detectCycleState(data) {
  const events = [
    ...parseEventBlock(data?.month1Events),
    ...parseEventBlock(data?.month2Events)
  ].sort((a, b) => a.unix - b.unix);

  const last = events[events.length - 1];
  if (!last) {
    return { lastMap: null, weekday: DEFAULT_WEEKDAY, hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE };
  }

  // Day-of-week and local time in Warsaw for the last event.
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    weekday:  'short',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false
  });
  const parts = dateFmt.formatToParts(new Date(last.unix * 1000));
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? '';
  const hourStr    = parts.find(p => p.type === 'hour')?.value ?? String(DEFAULT_HOUR);
  const minuteStr  = parts.find(p => p.type === 'minute')?.value ?? String(DEFAULT_MINUTE);

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    lastMap: last.map,
    weekday: weekdayMap[weekdayStr] ?? DEFAULT_WEEKDAY,
    hour:    parseInt(hourStr, 10),
    minute:  parseInt(minuteStr, 10)
  };
}

/**
 * Builds the rendered event block (one event per Wednesday of the month)
 * starting from `startMap` in the cycle. Returns:
 *   { text, nextMap }
 * where `text` is the embed-ready string and `nextMap` is the next map in
 * the cycle after the last one written, so it can be chained across months.
 */
function buildMonthEvents(year, month, startMap, weekday, hour, minute) {
  const days  = weekdaysInMonth(year, month, weekday);
  if (!days.length) return { text: '— No events scheduled —', nextMap: startMap };

  const lines = [];
  let cursor  = matchCycleMap(startMap) || MAP_CYCLE[0];
  let idx     = MAP_CYCLE.indexOf(cursor);

  for (const d of days) {
    const unix = warsawToUnix(year, month, d, hour, minute);
    lines.push(`<t:${unix}:f> - **${MAP_CYCLE[idx]}**`);
    idx = (idx + 1) % MAP_CYCLE.length;
  }

  return { text: lines.join('\n\n'), nextMap: MAP_CYCLE[idx] };
}

/**
 * Generates a fresh 2-month rotation when the embed is empty. `now` defaults
 * to the current time; accept an explicit value for testability.
 */
function bootstrapRotationData(now = new Date()) {
  const year  = now.getFullYear();
  const month = now.getMonth();

  const block1 = buildMonthEvents(year, month, MAP_CYCLE[0],
    DEFAULT_WEEKDAY, DEFAULT_HOUR, DEFAULT_MINUTE);

  const y2 = month === 11 ? year + 1 : year;
  const m2 = (month + 1) % 12;
  const block2 = buildMonthEvents(y2, m2, block1.nextMap,
    DEFAULT_WEEKDAY, DEFAULT_HOUR, DEFAULT_MINUTE);

  return {
    month1Header: monthHeader(year, month),
    month1Events: block1.text,
    month2Header: monthHeader(y2, m2),
    month2Events: block2.text
  };
}

/**
 * Given the current rotation data, returns the next iteration — month2
 * becomes month1, and a brand-new month is generated below it by continuing
 * the map cycle where the last event left off.
 *
 * Timing (weekday + hour) is inherited from the most recent event in the
 * embed, so admins can customize the slot via Edit Rotation and the auto
 * rollover respects it.
 */
function advanceRotationData(data) {
  if (!data) return bootstrapRotationData();

  const { weekday, hour, minute } = detectCycleState(data);
  const oldMonth2 = parseMonthHeader(data.month2Header);
  if (!oldMonth2) return bootstrapRotationData();

  // New top = old bottom.
  const newTopHeader = monthHeader(oldMonth2.year, oldMonth2.month);
  const newTopEvents = data.month2Events;

  // New bottom = the month after the old bottom, continuing the cycle.
  const m3 = (oldMonth2.month + 1) % 12;
  const y3 = oldMonth2.month === 11 ? oldMonth2.year + 1 : oldMonth2.year;

  const lastMapInTop = (parseEventBlock(newTopEvents).pop() || {}).map || null;
  const startForNewBottom = nextMapAfter(lastMapInTop);
  const block = buildMonthEvents(y3, m3, startForNewBottom, weekday, hour, minute);

  return {
    month1Header: newTopHeader,
    month1Events: newTopEvents,
    month2Header: monthHeader(y3, m3),
    month2Events: block.text
  };
}

/**
 * Returns true when every event in month1 is in the past, so the rolling
 * window is due to advance.
 */
function shouldAdvanceNow(data, now = new Date()) {
  if (!data) return false;
  const events = parseEventBlock(data.month1Events);
  if (!events.length) return false;
  const nowSec = Math.floor(now.getTime() / 1000);
  return events.every(e => e.unix < nowSec);
}

module.exports = {
  advanceRotationData,
  bootstrapRotationData,
  shouldAdvanceNow
};
