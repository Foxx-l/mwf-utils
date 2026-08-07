// @ts-check
/**
 * midCapPoll.js — Builds the native Discord poll for a match. Pure: no client,
 * no disk, so the question/answers/duration are testable on their own.
 *
 * Discord's own limits are enforced here rather than discovered at send time:
 * a poll allows at most 10 answers of 55 characters, a 300-character question,
 * and a duration of 1–768 hours (32 days).
 */

const { PollLayoutType } = require('discord.js');
const { TIME_ZONE } = require('./warsawTime');

const MAX_QUESTION_CHARS = 300;
const MAX_ANSWER_CHARS = 55;
const MAX_ANSWERS = 10;
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 768;

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "Wed 12 Aug", on the Warsaw clock. */
function formatMatchDay(match) {
  return dayFormatter.format(new Date(match.unix * 1000));
}

/**
 * Whole hours from `now` until kick-off, clamped into Discord's allowed range.
 * The poll therefore closes when the match starts.
 * @param {{ unix: number }} match
 * @param {Date} [now]
 */
function pollDurationHours(match, now = new Date()) {
  const secondsLeft = match.unix - Math.floor(now.getTime() / 1000);
  const hours = Math.ceil(secondsLeft / 3600);
  return Math.min(MAX_DURATION_HOURS, Math.max(MIN_DURATION_HOURS, hours));
}

/**
 * The poll payload for `channel.send({ poll })`.
 * @param {{ map: string, unix: number }} match
 * @param {string[]} caps
 * @param {Date} [now]
 * @returns {import('discord.js').PollData}
 */
function buildPoll(match, caps, now = new Date()) {
  return {
    question: { text: `Mid cap — ${match.map} (${formatMatchDay(match)})`.slice(0, MAX_QUESTION_CHARS) },
    answers: caps.slice(0, MAX_ANSWERS).map(cap => ({ text: String(cap).slice(0, MAX_ANSWER_CHARS) })),
    duration: pollDurationHours(match, now),
    allowMultiselect: false,
    layoutType: PollLayoutType.Default,
  };
}

module.exports = {
  buildPoll,
  pollDurationHours,
  formatMatchDay,
  MAX_QUESTION_CHARS,
  MAX_ANSWER_CHARS,
  MAX_ANSWERS,
  MIN_DURATION_HOURS,
  MAX_DURATION_HOURS,
};
