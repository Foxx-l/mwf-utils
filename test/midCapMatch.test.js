/**
 * Which match the Mid Cap poll covers, and how the handler decides whether
 * there is a poll to post at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { currentEvent, LIVE_WINDOW_HOURS } = require('../src/utils/rotationState');
const { warsawToUnix } = require('../src/utils/warsawTime');

/** State with Wednesday events at 20:00 Warsaw. */
function state(events = [
  { date: '2026-08-05', time: '20:00', map: 'Utah' },
  { date: '2026-08-12', time: '20:00', map: 'Carentan' },
], second = [{ date: '2026-09-02', time: '20:00', map: 'Omaha' }]) {
  return {
    version: 1,
    revision: 1,
    messageId: null,
    months: [
      { year: 2026, month: 7, events },
      { year: 2026, month: 8, events: second },
    ],
    nextMapIndex: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** A Date at the given Warsaw wall-clock time. */
function warsaw(year, month, day, hour, minute = 0) {
  return new Date(warsawToUnix(year, month, day, hour, minute) * 1000);
}

describe('currentEvent', () => {
  test('picks the next scheduled event', () => {
    expect(currentEvent(state(), warsaw(2026, 7, 6, 12)))
      .toMatchObject({ date: '2026-08-12', map: 'Carentan', live: false });
  });

  test('an event stays current during its live window', () => {
    expect(currentEvent(state(), warsaw(2026, 7, 12, 21, 30)))
      .toMatchObject({ date: '2026-08-12', live: true });
    expect(currentEvent(state(), warsaw(2026, 7, 12, 20 + LIVE_WINDOW_HOURS - 1)).date)
      .toBe('2026-08-12');
  });

  test('once the window closes it moves to the following event', () => {
    expect(currentEvent(state(), warsaw(2026, 7, 13, 10)))
      .toMatchObject({ date: '2026-09-02', map: 'Omaha', live: false });
  });

  test('an event exactly at kick-off counts as live', () => {
    expect(currentEvent(state(), warsaw(2026, 7, 12, 20)).live).toBe(true);
  });

  test('returns null when the whole window is in the past', () => {
    expect(currentEvent(state(), warsaw(2026, 11, 1, 12))).toBeNull();
  });

  test('handles missing, empty and malformed state without throwing', () => {
    expect(currentEvent(null)).toBeNull();
    expect(currentEvent({ months: [] })).toBeNull();
    expect(currentEvent({ months: [{ events: [] }, { events: [] }] })).toBeNull();
    expect(currentEvent({ months: [{ events: [{ date: 'not-a-date', map: 'X' }] }, { events: [] }] })).toBeNull();
  });

  test('events out of order across months still resolve chronologically', () => {
    const unordered = state();
    unordered.months.reverse();
    expect(currentEvent(unordered, warsaw(2026, 7, 6, 12)).map).toBe('Carentan');
  });
});

describe('describeMidCapPoll', () => {
  let dir;
  let handler;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-midcapplan-'));
    process.env.DATA_DIR = dir;
    process.env.MAP_ROTATION_CHANNEL = 'rot-chan';
    jest.resetModules();
    handler = require('../src/handlers/interactions/midCapHandler');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.MAP_ROTATION_CHANNEL;
  });

  function writeState(events, second) {
    fs.writeFileSync(
      path.join(dir, 'rotation_state.json'),
      JSON.stringify({ 'rot-chan': state(events, second) }),
      'utf8',
    );
  }

  test('plans a poll for the next match', () => {
    writeState();
    const plan = handler.describeMidCapPoll(warsaw(2026, 7, 10, 12));
    expect(plan.ok).toBe(true);
    expect(plan.match.map).toBe('Carentan');
    expect(plan.caps).toEqual(['Canal Crossing', 'Town Center', 'Train Station']);
    expect(plan.poll.answers).toHaveLength(3);
    expect(plan.key).toBe('2026-08-12|Carentan');
  });

  test('refuses once the match has started — nothing left to vote on', () => {
    writeState();
    const plan = handler.describeMidCapPoll(warsaw(2026, 7, 12, 21));
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/already started/);
  });

  test('refuses a map with no mid caps, naming it', () => {
    writeState([{ date: '2026-08-12', time: '20:00', map: 'Kokoda Trail' }], []);
    const plan = handler.describeMidCapPoll(warsaw(2026, 7, 10, 12));
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/no mid caps configured for "Kokoda Trail"/);
  });

  test('refuses when the rotation has no upcoming match', () => {
    writeState([], []);
    expect(handler.describeMidCapPoll(warsaw(2026, 7, 10, 12)))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/no upcoming match/) });
  });

  test('an odd map spelling in the rotation still resolves', () => {
    writeState([{ date: '2026-08-12', time: '20:00', map: 'Sainte-Mère-Église' }], []);
    const plan = handler.describeMidCapPoll(warsaw(2026, 7, 10, 12));
    expect(plan.ok).toBe(true);
    expect(plan.caps).toContain('Hospice');
    // The question keeps the rotation's spelling — that's what admins wrote.
    expect(plan.poll.question.text).toContain('Sainte-Mère-Église');
  });
});
