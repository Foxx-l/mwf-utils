// @ts-check
/**
 * midCapVote.js — Pure vote math for the Mid Cap poll. No Discord, no disk.
 *
 * A ballot box is `{ [userId]: { cap, team, ts } }`. Each member holds exactly
 * one vote, attributed to the team of the faction role they held when they
 * voted; counts are always derived from the ballots, never stored.
 */

const BAR_WIDTH = 10;
const BAR_FULL = '█';
const BAR_EMPTY = '░';

/**
 * Vote counts per cap, in the caps' declared order. Ballots for caps that are
 * no longer on offer (map changed, sheet edited) are ignored rather than
 * silently reassigned.
 *
 * @param {Record<string, {cap: string, team: string}>} ballots
 * @param {string[]} caps
 * @returns {{ cap: string, allies: number, axis: number, total: number }[]}
 */
function tallyVotes(ballots, caps) {
  const rows = caps.map(cap => ({ cap, allies: 0, axis: 0, total: 0 }));
  const byCap = new Map(rows.map(row => [row.cap, row]));

  for (const ballot of Object.values(ballots || {})) {
    const row = byCap.get(ballot?.cap);
    if (!row) continue;
    if (ballot.team === 'allies') row.allies++;
    else if (ballot.team === 'axis') row.axis++;
    else continue;
    row.total++;
  }
  return rows;
}

/**
 * The cap(s) with the most votes for a team. Empty when nobody has voted;
 * more than one entry means a tie, which the caller should render as such
 * rather than picking a winner.
 *
 * @param {{ cap: string, allies: number, axis: number }[]} tally
 * @param {'allies'|'axis'} team
 * @returns {string[]}
 */
function leaders(tally, team) {
  const best = Math.max(0, ...tally.map(row => row[team]));
  if (best === 0) return [];
  return tally.filter(row => row[team] === best).map(row => row.cap);
}

/** Total ballots cast per team. */
function totals(tally) {
  return {
    allies: tally.reduce((sum, row) => sum + row.allies, 0),
    axis: tally.reduce((sum, row) => sum + row.axis, 0),
  };
}

/**
 * Fixed-width bar, scaled against `max` so bars are comparable across caps.
 * @param {number} count
 * @param {number} max
 * @param {number} [width]
 */
function bar(count, max, width = BAR_WIDTH) {
  if (!(max > 0) || !(count > 0)) return BAR_EMPTY.repeat(width);
  const filled = Math.max(1, Math.min(width, Math.round((count / max) * width)));
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(width - filled);
}

/** Largest single-team count in the tally — the scale for every bar. */
function peak(tally) {
  return Math.max(0, ...tally.flatMap(row => [row.allies, row.axis]));
}

/**
 * Applies a click: the same cap again retracts the vote, a different cap moves
 * it. Returns a new ballot box plus what happened, so the caller can both
 * persist and phrase its reply from one result.
 *
 * @param {Record<string, {cap: string, team: string, ts: number}>} ballots
 * @param {string} userId
 * @param {'allies'|'axis'} team
 * @param {string} cap
 * @param {number} ts
 * @returns {{ ballots: Record<string, {cap: string, team: string, ts: number}>, action: 'added'|'moved'|'retracted', previousCap: string|null }}
 */
function applyVote(ballots, userId, team, cap, ts = 0) {
  const next = { ...(ballots || {}) };
  const previous = next[userId] ?? null;

  if (previous && previous.cap === cap) {
    delete next[userId];
    return { ballots: next, action: 'retracted', previousCap: previous.cap };
  }

  next[userId] = { cap, team, ts };
  return {
    ballots: next,
    action: previous ? 'moved' : 'added',
    previousCap: previous ? previous.cap : null,
  };
}

module.exports = { tallyVotes, leaders, totals, bar, peak, applyVote, BAR_WIDTH };
