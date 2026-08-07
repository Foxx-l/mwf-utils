const {
  buildPoll,
  pollDurationHours,
  formatMatchDay,
  MAX_ANSWER_CHARS,
  MAX_QUESTION_CHARS,
  MAX_ANSWERS,
  MIN_DURATION_HOURS,
  MAX_DURATION_HOURS,
} = require('../src/utils/midCapPoll');
const { warsawToUnix } = require('../src/utils/warsawTime');

// Wednesday 12 August 2026, 20:00 Warsaw.
const KICKOFF = warsawToUnix(2026, 7, 12, 20, 0);
const MATCH = { date: '2026-08-12', time: '20:00', map: 'Carentan', unix: KICKOFF, live: false };
const CAPS = ['Canal Crossing', 'Town Center', 'Train Station'];

/** `hours` before kick-off. */
const before = hours => new Date((KICKOFF - hours * 3600) * 1000);

describe('pollDurationHours', () => {
  test('runs until kick-off, rounded up to whole hours', () => {
    expect(pollDurationHours(MATCH, before(48))).toBe(48);
    expect(pollDurationHours(MATCH, before(6.5))).toBe(7);
  });

  test('never returns less than Discord\'s minimum', () => {
    expect(pollDurationHours(MATCH, before(0.25))).toBe(MIN_DURATION_HOURS);
    expect(pollDurationHours(MATCH, new Date(KICKOFF * 1000))).toBe(MIN_DURATION_HOURS);
    // Past kick-off the caller skips posting, but the value must stay legal.
    expect(pollDurationHours(MATCH, new Date((KICKOFF + 7200) * 1000))).toBe(MIN_DURATION_HOURS);
  });

  test('clamps to Discord\'s 32-day maximum', () => {
    expect(pollDurationHours(MATCH, before(2000))).toBe(MAX_DURATION_HOURS);
  });
});

describe('buildPoll', () => {
  test('asks about the map and names the match day', () => {
    const poll = buildPoll(MATCH, CAPS, before(24));
    expect(poll.question.text).toBe('Mid cap — Carentan (Wed 12 Aug)');
    expect(poll.question.text.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
  });

  test('offers each cap as an answer, single choice', () => {
    const poll = buildPoll(MATCH, CAPS, before(24));
    expect(poll.answers).toEqual([
      { text: 'Canal Crossing' },
      { text: 'Town Center' },
      { text: 'Train Station' },
    ]);
    expect(poll.allowMultiselect).toBe(false);
  });

  test('closes at kick-off', () => {
    expect(buildPoll(MATCH, CAPS, before(72)).duration).toBe(72);
  });

  test('respects Discord\'s answer count and length limits', () => {
    const many = Array.from({ length: 15 }, (_, i) => `Cap ${i}`);
    expect(buildPoll(MATCH, many, before(24)).answers).toHaveLength(MAX_ANSWERS);

    const long = buildPoll(MATCH, ['x'.repeat(200)], before(24));
    expect(long.answers[0].text).toHaveLength(MAX_ANSWER_CHARS);
  });

  test('formatMatchDay uses the Warsaw clock', () => {
    // 00:30 Warsaw on 13 Aug is still 12 Aug in UTC — the label must say the
    // Warsaw day, not the UTC one.
    const lateNight = { ...MATCH, unix: warsawToUnix(2026, 7, 13, 0, 30) };
    expect(formatMatchDay(lateNight)).toBe('Thu 13 Aug');
  });
});
