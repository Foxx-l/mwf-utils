// @ts-check
/**
 * midCapStore.js — Remembers which Discord poll was posted for which match.
 *
 * The votes themselves are Discord's business: the mid cap vote is a native
 * poll, so this store only holds pointers. Keyed by match (`YYYY-MM-DD|Map`) so
 * the bot posts exactly one poll per match and can close the previous one when
 * the next goes up. Pointers are pruned to the newest few matches.
 */

const fs = require('fs');
const logger = require('./logger');
const { dataPath } = require('./dataDir');

const DATA_PATH = dataPath('midcap_polls.json');
const POLL_LIMIT = 8;

/** @param {string} date @param {string} map */
function matchKey(date, map) {
  return `${date}|${map}`;
}

function _read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return { polls: (parsed?.polls && typeof parsed.polls === 'object') ? parsed.polls : {} };
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Could not read ${DATA_PATH}: ${err.message}`);
    return { polls: {} };
  }
}

function _write(store) {
  try {
    const tempPath = `${DATA_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tempPath, DATA_PATH);
    return true;
  } catch (err) {
    logger.warn(`Could not write ${DATA_PATH}: ${err.message}`);
    return false;
  }
}

/** Keeps the newest POLL_LIMIT entries (keys sort chronologically by date). */
function _prune(polls, keepKey) {
  const keys = Object.keys(polls).sort();
  if (keys.length <= POLL_LIMIT) return polls;
  const keep = new Set([keepKey, ...keys.slice(-POLL_LIMIT)]);
  return Object.fromEntries(Object.entries(polls).filter(([key]) => keep.has(key)));
}

/**
 * The poll posted for a match, or null.
 * @param {string} key
 * @returns {{ channelId: string, messageId: string, postedAt: number, closed?: boolean }|null}
 */
function loadPoll(key) {
  return _read().polls[key] ?? null;
}

/**
 * @param {string} key
 * @param {{ channelId: string, messageId: string, postedAt: number, closed?: boolean }} pointer
 */
function savePoll(key, pointer) {
  const store = _read();
  store.polls = _prune({ ...store.polls, [key]: pointer }, key);
  return _write(store);
}

/** Marks a poll as closed so it isn't ended again on the next post. */
function markClosed(key) {
  const store = _read();
  const pointer = store.polls[key];
  if (!pointer || pointer.closed) return false;
  store.polls[key] = { ...pointer, closed: true };
  return _write(store);
}

function clearPoll(key) {
  const store = _read();
  if (store.polls[key] === undefined) return false;
  delete store.polls[key];
  return _write(store);
}

/** Every known poll as `[matchKey, pointer]`, oldest match first. */
function listPolls() {
  const { polls } = _read();
  return Object.keys(polls).sort().map(key => /** @type {[string, any]} */ ([key, polls[key]]));
}

module.exports = {
  matchKey,
  loadPoll,
  savePoll,
  markClosed,
  clearPoll,
  listPolls,
  DATA_PATH,
  POLL_LIMIT,
};
