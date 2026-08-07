/**
 * What the Mid Cap vote is about (which rotation event) and who may vote
 * (which team a member's faction role puts them on).
 */

process.env.ALLIES_ROLE    = 'role-allies-s1';
process.env.AXIS_ROLE      = 'role-axis-s1';
process.env.ALLIES_S2_ROLE = 'role-allies-s2';
process.env.AXIS_S2_ROLE   = 'role-axis-s2';

const { currentEvent, LIVE_WINDOW_HOURS } = require('../src/utils/rotationState');
const { getMemberTeam } = require('../src/config/factions');
const { warsawToUnix } = require('../src/utils/warsawTime');

/** State with three Wednesday events at 20:00 Warsaw, August 2026. */
function state() {
  return {
    version: 1,
    revision: 1,
    messageId: null,
    months: [
      {
        year: 2026, month: 7, events: [
          { date: '2026-08-05', time: '20:00', map: 'Utah' },
          { date: '2026-08-12', time: '20:00', map: 'Carentan' },
        ],
      },
      {
        year: 2026, month: 8, events: [
          { date: '2026-09-02', time: '20:00', map: 'Omaha' },
        ],
      },
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
    const event = currentEvent(state(), warsaw(2026, 7, 6, 12));
    expect(event).toMatchObject({ date: '2026-08-12', map: 'Carentan', live: false });
  });

  test('an event stays current during its live window', () => {
    const duringMatch = currentEvent(state(), warsaw(2026, 7, 12, 21, 30));
    expect(duringMatch).toMatchObject({ date: '2026-08-12', live: true });

    const justInside = currentEvent(state(), warsaw(2026, 7, 12, 20 + LIVE_WINDOW_HOURS - 1));
    expect(justInside.date).toBe('2026-08-12');
  });

  test('once the window closes it moves to the following event', () => {
    const next = currentEvent(state(), warsaw(2026, 7, 13, 10));
    expect(next).toMatchObject({ date: '2026-09-02', map: 'Omaha', live: false });
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
    const broken = { months: [{ events: [{ date: 'not-a-date', map: 'X' }] }, { events: [] }] };
    expect(currentEvent(broken)).toBeNull();
  });

  test('events out of order across months still resolve chronologically', () => {
    const unordered = state();
    unordered.months.reverse();
    expect(currentEvent(unordered, warsaw(2026, 7, 6, 12)).map).toBe('Carentan');
  });
});

describe('getMemberTeam', () => {
  const member = (...roleIds) => ({ roles: { cache: { has: id => roleIds.includes(id) } } });

  test('maps each faction role to its side', () => {
    expect(getMemberTeam(member('role-allies-s1'))).toBe('allies');
    expect(getMemberTeam(member('role-axis-s1'))).toBe('axis');
  });

  test('S2 roles count for the same team as S1', () => {
    expect(getMemberTeam(member('role-allies-s2'))).toBe('allies');
    expect(getMemberTeam(member('role-axis-s2'))).toBe('axis');
    expect(getMemberTeam(member('role-allies-s1', 'role-allies-s2'))).toBe('allies');
  });

  test('no faction role means no vote', () => {
    expect(getMemberTeam(member())).toBeNull();
    expect(getMemberTeam(member('some-other-role'))).toBeNull();
    expect(getMemberTeam(undefined)).toBeNull();
    expect(getMemberTeam({})).toBeNull();
  });

  test('holding both sides is refused rather than guessed', () => {
    expect(getMemberTeam(member('role-allies-s1', 'role-axis-s2'))).toBeNull();
  });
});
