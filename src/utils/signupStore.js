// @ts-check
/**
 * signupStore.js — Persists the per-clan signup feature's state in the data
 * directory: the auto-post switch, the signup category/channel ids, and which
 * RaidHelper events were already created per match date. The posted-events
 * record is what makes posting idempotent — a daily scheduler tick or a
 * repeated panel click skips every (date, clan) pair that is already there.
 */

const fs = require('fs');
const logger = require('./logger');
const { dataPath } = require('./dataDir');

const DATA_PATH = dataPath('signups_data.json');

/** Store key for the solo (clanless) signup channel/event. */
const SOLO_KEY = '__solo__';

/**
 * @typedef {{ auto_post: boolean, category_id: string|null,
 *             channels: Record<string, string>,
 *             events: Record<string, Record<string, { id: string, channelId: string }>> }} SignupState
 */

/** @returns {SignupState} */
function _empty() {
  return { auto_post: false, category_id: null, channels: {}, events: {} };
}

/** @returns {SignupState} */
function _read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return {
      auto_post: Boolean(parsed?.auto_post),
      category_id: typeof parsed?.category_id === 'string' ? parsed.category_id : null,
      channels: parsed?.channels && typeof parsed.channels === 'object' ? parsed.channels : {},
      events: parsed?.events && typeof parsed.events === 'object' ? parsed.events : {},
    };
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Could not read ${DATA_PATH}: ${err.message}`);
    return _empty();
  }
}

/** @param {SignupState} state */
function _write(state) {
  try {
    const tempPath = `${DATA_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempPath, DATA_PATH);
    return true;
  } catch (err) {
    logger.warn(`Could not write ${DATA_PATH}: ${err.message}`);
    return false;
  }
}

/** Full current state (a fresh copy — mutations are not persisted). */
function getState() {
  return _read();
}

/** @param {boolean} enabled */
function setAutoPost(enabled) {
  const state = _read();
  state.auto_post = Boolean(enabled);
  return _write(state);
}

/** @param {string} categoryId */
function setCategoryId(categoryId) {
  const state = _read();
  state.category_id = categoryId;
  return _write(state);
}

/**
 * Remembers the channel used for a clan (or SOLO_KEY).
 * @param {string} key @param {string} channelId
 */
function setChannel(key, channelId) {
  const state = _read();
  state.channels[key] = channelId;
  return _write(state);
}

/**
 * @param {string} date - match date `YYYY-MM-DD`
 * @param {string} key  - clan tag or SOLO_KEY
 */
function getEvent(date, key) {
  return _read().events[date]?.[key] ?? null;
}

/**
 * Records a created RaidHelper event so it is never posted twice.
 * @param {string} date @param {string} key
 * @param {{ id: string, channelId: string }} event
 */
function recordEvent(date, key, event) {
  const state = _read();
  state.events[date] = state.events[date] || {};
  state.events[date][key] = { id: String(event.id), channelId: String(event.channelId) };
  return _write(state);
}

/**
 * Forgets one recorded event (after deletion). Removes the date bucket when
 * it empties so old dates don't accumulate empty objects.
 * @param {string} date @param {string} key
 */
function clearEvent(date, key) {
  const state = _read();
  if (state.events[date]) {
    delete state.events[date][key];
    if (!Object.keys(state.events[date]).length) delete state.events[date];
  }
  return _write(state);
}

/** All recorded events for a date: `{ key: { id, channelId } }`. */
/** @param {string} date */
function eventsForDate(date) {
  return { ..._read().events[date] ?? {} };
}

module.exports = {
  getState,
  setAutoPost,
  setCategoryId,
  setChannel,
  getEvent,
  recordEvent,
  clearEvent,
  eventsForDate,
  SOLO_KEY,
  DATA_PATH,
};
