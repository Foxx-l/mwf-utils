const { warsawDateParts, warsawToUnix, warsawTimeToUnix } = require('../src/utils/warsawTime');

describe('warsawToUnix', () => {
  test('winter time (CET, UTC+1)', () => {
    expect(warsawToUnix(2026, 0, 15, 20, 0)).toBe(Date.UTC(2026, 0, 15, 19, 0) / 1000);
  });

  test('summer time (CEST, UTC+2)', () => {
    expect(warsawToUnix(2026, 6, 15, 20, 0)).toBe(Date.UTC(2026, 6, 15, 18, 0) / 1000);
  });

  test('on the spring-forward day (2026-03-29) evening slots are CEST', () => {
    expect(warsawToUnix(2026, 2, 29, 20, 0)).toBe(Date.UTC(2026, 2, 29, 18, 0) / 1000);
  });

  test('on the fall-back day (2026-10-25) evening slots are CET', () => {
    expect(warsawToUnix(2026, 9, 25, 20, 0)).toBe(Date.UTC(2026, 9, 25, 19, 0) / 1000);
  });

  test('the day before and after each DST switch keep their offsets', () => {
    expect(warsawToUnix(2026, 2, 28, 20, 0)).toBe(Date.UTC(2026, 2, 28, 19, 0) / 1000); // still CET
    expect(warsawToUnix(2026, 2, 30, 20, 0)).toBe(Date.UTC(2026, 2, 30, 18, 0) / 1000); // now CEST
    expect(warsawToUnix(2026, 9, 24, 20, 0)).toBe(Date.UTC(2026, 9, 24, 18, 0) / 1000); // still CEST
    expect(warsawToUnix(2026, 9, 26, 20, 0)).toBe(Date.UTC(2026, 9, 26, 19, 0) / 1000); // now CET
  });

  test('handles minute-precision times', () => {
    expect(warsawToUnix(2026, 7, 5, 19, 30)).toBe(Date.UTC(2026, 7, 5, 17, 30) / 1000);
  });

  test('warsawTimeToUnix accepts HH:MM strings', () => {
    expect(warsawTimeToUnix(2026, 7, 5, '19:30')).toBe(warsawToUnix(2026, 7, 5, 19, 30));
  });
});

describe('warsawDateParts', () => {
  test('decomposes an instant into Warsaw wall-clock parts', () => {
    // 2026-08-07 22:30 UTC is 2026-08-08 00:30 in Warsaw (CEST)
    const parts = warsawDateParts(new Date('2026-08-07T22:30:00Z'));
    expect(parts).toMatchObject({ year: 2026, month: 7, day: 8, hour: 0, minute: 30 });
    expect(parts.weekday).toBe(6); // Saturday
  });

  test('a Warsaw-local time round-trips through warsawToUnix', () => {
    const unix = warsawToUnix(2026, 11, 30, 22, 0);
    const back = warsawDateParts(new Date(unix * 1000));
    expect(back).toMatchObject({ year: 2026, month: 11, day: 30, hour: 22, minute: 0 });
  });

  test('winter round-trip across a year boundary', () => {
    const unix = warsawToUnix(2026, 11, 31, 23, 15);
    const back = warsawDateParts(new Date(unix * 1000));
    expect(back).toMatchObject({ year: 2026, month: 11, day: 31, hour: 23, minute: 15 });
  });
});
