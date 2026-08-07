// @ts-check
/**
 * midCapStore.js — Persists Mid Cap ballots and the pointer to the vote embed.
 *
 * Ballots are keyed by match (`YYYY-MM-DD|Map`), so every match starts with an
 * empty poll and last week's votes can't leak into this week's. Old polls are
 * pruned on write.
 *
 * Writes go through a promise chain: unlike the other stores, several members
 * can click within the same tick, and a plain read-modify-write would drop
 * votes. `castVote` is the only mutating path for ballots and it is serialized.
 */

const fs = require('fs');
const logger = require('./logger');
const { dataPath } = require('./dataDir');
const { applyVote } = require('./midCapVote');

const DATA_PATH = dataPath('midcap_votes.json');
const POLL_LIMIT = 8; // keep the current match plus a few weeks of history

/** @param {string} date @param {string} map */
function matchKey(date, map) {
  return `${date}|${map}`;
}

function _read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return {
      message: parsed?.message ?? null,
      polls: (parsed?.polls && typeof parsed.polls === 'object') ? parsed.polls : {},
    };
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Could not read ${DATA_PATH}: ${err.message}`);
    return { message: null, polls: {} };
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

/** Keeps the newest POLL_LIMIT polls (keys sort chronologically by date). */
function _prune(polls, keepKey) {
  const keys = Object.keys(polls).sort();
  if (keys.length <= POLL_LIMIT) return polls;
  const keep = new Set([keepKey, ...keys.slice(-POLL_LIMIT)]);
  return Object.fromEntries(Object.entries(polls).filter(([key]) => keep.has(key)));
}

/** Ballots for one match; `{}` when nobody has voted yet. */
function loadBallots(key) {
  return _read().polls[key] ?? {};
}

// ── Serialized mutation ──────────────────────────────────────────────────────

let writeChain = Promise.resolve();

/**
 * Records a click and returns the resulting ballots. Same cap again retracts,
 * a different cap moves the vote.
 *
 * @param {string} key match key from matchKey()
 * @param {string} userId
 * @param {'allies'|'axis'} team
 * @param {string} cap
 * @returns {Promise<{ ballots: Record<string, {cap: string, team: string, ts: number}>, action: 'added'|'moved'|'retracted', previousCap: string|null, saved: boolean }>}
 */
function castVote(key, userId, team, cap) {
  const run = writeChain.then(() => {
    const store = _read();
    const result = applyVote(store.polls[key] ?? {}, userId, team, cap, Date.now());
    store.polls = _prune({ ...store.polls, [key]: result.ballots }, key);
    return { ...result, saved: _write(store) };
  });
  // Keep the chain alive even if this write throws, so one failure can't wedge
  // every later vote.
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Clears one match's ballots (admin reset of a poll). */
function clearBallots(key) {
  const run = writeChain.then(() => {
    const store = _read();
    if (store.polls[key] === undefined) return false;
    delete store.polls[key];
    return _write(store);
  });
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

// ── Embed message pointer ────────────────────────────────────────────────────

function saveCapMessage(channelId, messageId) {
  const store = _read();
  store.message = { channelId, messageId };
  return _write(store);
}

function loadCapMessage() {
  return _read().message;
}

function clearCapMessage() {
  const store = _read();
  if (!store.message) return false;
  store.message = null;
  return _write(store);
}

module.exports = {
  matchKey,
  loadBallots,
  castVote,
  clearBallots,
  saveCapMessage,
  loadCapMessage,
  clearCapMessage,
  DATA_PATH,
  POLL_LIMIT,
};
