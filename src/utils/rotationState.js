// @ts-check

/**
 * @typedef {Object} RotationEvent
 * @property {string} date  ISO date `YYYY-MM-DD`
 * @property {string} time  24-hour `HH:MM`, Europe/Warsaw
 * @property {string} map
 *
 * @typedef {Object} RotationMonth
 * @property {number} year
 * @property {number} month 0-11
 * @property {RotationEvent[]} events
 *
 * @typedef {Object} RotationState
 * @property {1} version
 * @property {number} revision  monotonically increasing; guards edit races
 * @property {string|null} messageId  Discord message currently rendering this state
 * @property {[RotationMonth, RotationMonth]} months
 * @property {number} nextMapIndex  index into MAP_CYCLE for the next generated month
 * @property {string} updatedAt  ISO timestamp
 */

const { getRotationEventTime } = require('../config/runtime');
const {
  warsawDateParts,
  warsawToUnix: warsawToUnixHMS,
} = require('./warsawTime');

const MAP_CYCLE = Object.freeze(['Utah', 'SMDM', 'Omaha', 'Carentan', 'SME']);
const MONTH_NAMES = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);
const STATE_VERSION = 1;
const MAX_CATCH_UP_MONTHS = 24;

function monthKey(year, month) {
  return year * 12 + month;
}

function monthHeader(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

function parseMonthHeader(header) {
  const match = String(header || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTH_NAMES.findIndex(name => name.toLowerCase() === match[1].toLowerCase());
  if (month < 0) return null;
  return { year: Number(match[2]), month };
}

function nextMonth(year, month) {
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
}

function validCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day;
}

/** Unix seconds for a Warsaw-local date at a 24-hour `HH:MM` time string. */
function warsawToUnix(year, month, day, time = getRotationEventTime()) {
  return warsawToUnixHMS(year, month, day, ...(time.split(':').map(Number)));
}

function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return validCalendarDate(year, month, day) ? { year, month, day } : null;
}

function weekdaysInMonth(year, month, weekday = 3) {
  const result = [];
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= count; day++) {
    if (new Date(Date.UTC(year, month, day)).getUTCDay() === weekday) result.push(day);
  }
  return result;
}

function generateMonth(year, month, startMapIndex = 0, time = getRotationEventTime()) {
  let index = ((startMapIndex % MAP_CYCLE.length) + MAP_CYCLE.length) % MAP_CYCLE.length;
  const events = weekdaysInMonth(year, month).map(day => {
    const event = { date: isoDate(year, month, day), time, map: MAP_CYCLE[index] };
    index = (index + 1) % MAP_CYCLE.length;
    return event;
  });
  return { month: { year, month, events }, nextMapIndex: index };
}

function createInitialState(now = new Date()) {
  const current = warsawDateParts(now);
  const first = generateMonth(current.year, current.month, 0);
  const secondDate = nextMonth(current.year, current.month);
  const second = generateMonth(secondDate.year, secondDate.month, first.nextMapIndex);
  return {
    version: STATE_VERSION,
    revision: 1,
    messageId: null,
    months: [first.month, second.month],
    nextMapIndex: second.nextMapIndex,
    updatedAt: new Date().toISOString(),
  };
}

function renderEvents(events) {
  if (!events?.length) return '— No events scheduled —';
  return events.map(event => {
    const date = parseIsoDate(event.date);
    if (!date) throw new Error(`Invalid stored event date: ${event.date}`);
    const unix = warsawToUnix(date.year, date.month, date.day, event.time || getRotationEventTime());
    return `<t:${unix}:f> - **${event.map}**`;
  }).join('\n\n');
}

function stateToEmbedData(state) {
  validateState(state);
  const data = {
    month1Header: monthHeader(state.months[0].year, state.months[0].month),
    month1Events: renderEvents(state.months[0].events),
    month2Header: monthHeader(state.months[1].year, state.months[1].month),
    month2Events: renderEvents(state.months[1].events),
  };
  for (const [label, value] of [['Month 1', data.month1Events], ['Month 2', data.month2Events]]) {
    if (value.length > 1024) throw new Error(`${label} is ${value.length} characters; Discord allows 1024.`);
  }
  return data;
}

function stateToEditableData(state) {
  validateState(state);
  const format = month => month.events.length
    ? month.events.map(event => {
      const date = parseIsoDate(event.date);
      return `${String(date.day).padStart(2, '0')}/${String(date.month + 1).padStart(2, '0')}/${date.year} - ${event.map}`;
    }).join('\n')
    : '— No events scheduled —';
  return {
    month1Header: monthHeader(state.months[0].year, state.months[0].month),
    month1Events: format(state.months[0]),
    month2Header: monthHeader(state.months[1].year, state.months[1].month),
    month2Events: format(state.months[1]),
    eventTime: state.months.flatMap(month => month.events)[0]?.time || getRotationEventTime(),
  };
}

function validEventTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function parseEditableEvents(text, expected, label, eventTime = getRotationEventTime()) {
  if (!validEventTime(eventTime)) throw new Error('Event time must use 24-hour HH:MM format.');
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed === '— No events scheduled —') return [];
  const events = [];
  const seen = new Set();
  let previousDate = '';

  for (const [index, rawLine] of trimmed.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(.+)$/);
    if (!match) throw new Error(`${label}, line ${index + 1}: use DD/MM/YYYY - Map Name.`);
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const map = match[4].trim();
    if (!validCalendarDate(year, month, day)) throw new Error(`${label}, line ${index + 1}: invalid calendar date.`);
    if (year !== expected.year || month !== expected.month) {
      throw new Error(`${label}, line ${index + 1}: date must be in ${monthHeader(expected.year, expected.month)}.`);
    }
    if (!map || map.length > 80) throw new Error(`${label}, line ${index + 1}: map name must be 1-80 characters.`);
    const date = isoDate(year, month, day);
    if (seen.has(date)) throw new Error(`${label}: duplicate date ${match[1]}/${match[2]}/${match[3]}.`);
    if (previousDate && date < previousDate) throw new Error(`${label}: dates must be in ascending order.`);
    seen.add(date);
    previousDate = date;
    events.push({ date, time: eventTime, map });
  }
  return events;
}

function deriveNextMapIndex(months, fallback = 0) {
  const events = months.flatMap(month => month.events || []).sort((a, b) => a.date.localeCompare(b.date));
  for (let index = events.length - 1; index >= 0; index--) {
    const cycleIndex = MAP_CYCLE.findIndex(map => map.toLowerCase() === events[index].map.toLowerCase());
    if (cycleIndex >= 0) return (cycleIndex + 1) % MAP_CYCLE.length;
  }
  return fallback;
}

function buildEditedState(input, existingState) {
  validateState(existingState);
  const first = parseMonthHeader(input.month1Header);
  const second = parseMonthHeader(input.month2Header);
  if (!first || !second) throw new Error('Month headers must look like August 2026.');
  if (monthKey(second.year, second.month) !== monthKey(first.year, first.month) + 1) {
    throw new Error('Month 2 must be the calendar month immediately after Month 1.');
  }
  const eventTime = String(input.eventTime || getRotationEventTime()).trim();
  if (!validEventTime(eventTime)) throw new Error('Event time must use 24-hour HH:MM format.');
  const months = [
    { ...first, events: parseEditableEvents(input.month1Events, first, 'Month 1 Events', eventTime) },
    { ...second, events: parseEditableEvents(input.month2Events, second, 'Month 2 Events', eventTime) },
  ];
  const state = {
    ...existingState,
    version: STATE_VERSION,
    revision: existingState.revision + 1,
    months,
    nextMapIndex: deriveNextMapIndex(months, existingState.nextMapIndex),
    updatedAt: new Date().toISOString(),
  };
  stateToEmbedData(state);
  return state;
}

function summarizeStateChanges(before, after) {
  const flatten = state => new Map(state.months.flatMap(month => month.events.map(event => [event.date, event])));
  const oldEvents = flatten(before);
  const newEvents = flatten(after);
  const lines = [];
  for (const [date, event] of newEvents) {
    const old = oldEvents.get(date);
    if (!old) lines.push(`+ ${date} — ${event.map}`);
    else if (old.map !== event.map || old.time !== event.time) lines.push(`~ ${date} — ${old.map} → ${event.map} (${event.time})`);
  }
  for (const [date, event] of oldEvents) {
    if (!newEvents.has(date)) lines.push(`− ${date} — ${event.map}`);
  }
  return lines.length ? lines.slice(0, 15).join('\n') : 'No event changes detected.';
}

function advanceState(state) {
  validateState(state);
  const top = state.months[1];
  const next = nextMonth(top.year, top.month);
  const eventTime = state.months.flatMap(month => month.events)[0]?.time || getRotationEventTime();
  const generated = generateMonth(next.year, next.month, state.nextMapIndex, eventTime);
  return {
    ...state,
    revision: state.revision + 1,
    months: [top, generated.month],
    nextMapIndex: generated.nextMapIndex,
    updatedAt: new Date().toISOString(),
  };
}

function catchUpState(state, now = new Date(), limit = MAX_CATCH_UP_MONTHS) {
  validateState(state);
  const current = warsawDateParts(now);
  const currentKey = monthKey(current.year, current.month);
  let result = state;
  let advances = 0;
  while (monthKey(result.months[0].year, result.months[0].month) < currentKey && advances < limit) {
    result = advanceState(result);
    advances++;
  }
  const stillBehind = monthKey(result.months[0].year, result.months[0].month) < currentKey;
  return { state: result, advances, stillBehind };
}

function alignStateToCurrentMonth(state, now = new Date()) {
  validateState(state);
  const current = warsawDateParts(now);
  const stateKey = monthKey(state.months[0].year, state.months[0].month);
  const currentKey = monthKey(current.year, current.month);

  if (stateKey === currentKey) return { state, advances: 0, reset: false, stillBehind: false };
  if (stateKey < currentKey) {
    const caughtUp = catchUpState(state, now);
    return { ...caughtUp, reset: false };
  }

  // A future first month is usually left over from a premature manual advance
  // or legacy migration. Rebuild the current two-month window while keeping a
  // monotonically increasing revision and the existing Discord message ID.
  const fresh = createInitialState(now);
  fresh.revision = state.revision + 1;
  fresh.messageId = state.messageId;
  fresh.updatedAt = new Date().toISOString();
  return { state: fresh, advances: 0, reset: true, stillBehind: false };
}

function validateState(state) {
  if (!state || state.version !== STATE_VERSION) throw new Error('Unsupported or missing rotation state version.');
  if (!Number.isInteger(state.revision) || state.revision < 1) throw new Error('Invalid rotation revision.');
  if (!Array.isArray(state.months) || state.months.length !== 2) throw new Error('Rotation must contain exactly two months.');
  const [first, second] = state.months;
  for (const month of state.months) {
    if (!Number.isInteger(month.year) || !Number.isInteger(month.month) || month.month < 0 || month.month > 11) {
      throw new Error('Invalid stored rotation month.');
    }
    if (!Array.isArray(month.events)) throw new Error('Stored rotation events must be an array.');
  }
  if (monthKey(second.year, second.month) !== monthKey(first.year, first.month) + 1) {
    throw new Error('Stored rotation months are not consecutive.');
  }
  if (!Number.isInteger(state.nextMapIndex) || state.nextMapIndex < 0 || state.nextMapIndex >= MAP_CYCLE.length) {
    throw new Error('Invalid next map index.');
  }
  return true;
}

function recoverStateFromEmbed(embed, messageId = null) {
  const fields = embed?.fields || [];
  if (fields.length < 2) return null;
  const parsedMonths = [parseMonthHeader(fields[0].name), parseMonthHeader(fields[1].name)];
  if (!parsedMonths[0] || !parsedMonths[1]) return null;
  const months = parsedMonths.map((month, monthIndex) => {
    const events = [];
    for (const line of String(fields[monthIndex].value || '').split('\n')) {
      const match = line.trim().match(/^<t:(\d+):[a-zA-Z]>\s*-\s*\*\*(.+?)\*\*$/);
      if (!match) continue;
      const instant = new Date(Number(match[1]) * 1000);
      const parts = warsawDateParts(instant);
      events.push({ date: isoDate(parts.year, parts.month, parts.day), time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`, map: match[2].trim() });
    }
    return { ...month, events };
  });
  const state = {
    version: STATE_VERSION,
    revision: 1,
    messageId,
    months,
    nextMapIndex: deriveNextMapIndex(months, 0),
    updatedAt: new Date().toISOString(),
  };
  try {
    validateState(state);
    return state;
  } catch (_) {
    return null;
  }
}

module.exports = {
  MAP_CYCLE,
  STATE_VERSION,
  MAX_CATCH_UP_MONTHS,
  warsawDateParts,
  monthHeader,
  parseMonthHeader,
  warsawToUnix,
  createInitialState,
  stateToEmbedData,
  stateToEditableData,
  parseEditableEvents,
  buildEditedState,
  summarizeStateChanges,
  advanceState,
  catchUpState,
  alignStateToCurrentMonth,
  validateState,
  recoverStateFromEmbed,
};
