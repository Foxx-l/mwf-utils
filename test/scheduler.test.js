const { getResetSchedule, getNextResetTime } = require('../src/utils/scheduler');

describe('reset schedule', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test('defaults to Wednesday 22:00', () => {
    delete process.env.RESET_DAY;
    delete process.env.RESET_HOUR;
    expect(getResetSchedule()).toEqual({ day: 3, hour: 22 });
  });

  test('rejects out-of-range values', () => {
    process.env.RESET_DAY = '9';
    expect(getResetSchedule()).toBeNull();
    process.env.RESET_DAY = '3';
    process.env.RESET_HOUR = '25';
    expect(getResetSchedule()).toBeNull();
    process.env.RESET_HOUR = 'abc';
    expect(getResetSchedule()).toBeNull();
  });

  test('next reset from an earlier weekday points at this week (CEST)', () => {
    delete process.env.RESET_DAY;
    delete process.env.RESET_HOUR;
    // Tue 2026-08-04 12:00 Warsaw
    const unix = getNextResetTime(new Date('2026-08-04T10:00:00Z'));
    // Wed 2026-08-05 22:00 CEST = 20:00 UTC
    expect(new Date(unix * 1000).toISOString()).toBe('2026-08-05T20:00:00.000Z');
  });

  test('minutes before the reset still point at today', () => {
    delete process.env.RESET_DAY;
    delete process.env.RESET_HOUR;
    // Wed 2026-08-05 21:59 Warsaw
    const unix = getNextResetTime(new Date('2026-08-05T19:59:00Z'));
    expect(new Date(unix * 1000).toISOString()).toBe('2026-08-05T20:00:00.000Z');
  });

  test('the minute after the reset rolls to next week', () => {
    delete process.env.RESET_DAY;
    delete process.env.RESET_HOUR;
    // Wed 2026-08-05 22:01 Warsaw
    const unix = getNextResetTime(new Date('2026-08-05T20:01:00Z'));
    expect(new Date(unix * 1000).toISOString()).toBe('2026-08-12T20:00:00.000Z');
  });

  test('respects custom day/hour and works in winter (CET)', () => {
    process.env.RESET_DAY = '0';  // Sunday
    process.env.RESET_HOUR = '9';
    // Wed 2026-01-07 12:00 Warsaw → next Sunday is 2026-01-11
    const unix = getNextResetTime(new Date('2026-01-07T11:00:00Z'));
    // 09:00 CET = 08:00 UTC
    expect(new Date(unix * 1000).toISOString()).toBe('2026-01-11T08:00:00.000Z');
  });

  test('wraps across a month boundary', () => {
    delete process.env.RESET_DAY;
    delete process.env.RESET_HOUR;
    // Fri 2026-08-28 12:00 Warsaw → next Wednesday is 2026-09-02
    const unix = getNextResetTime(new Date('2026-08-28T10:00:00Z'));
    expect(new Date(unix * 1000).toISOString()).toBe('2026-09-02T20:00:00.000Z');
  });

  test('returns null when the schedule is invalid', () => {
    process.env.RESET_DAY = '12';
    expect(getNextResetTime(new Date('2026-08-04T10:00:00Z'))).toBeNull();
  });
});
