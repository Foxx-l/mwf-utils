const {
  MAP_CYCLE,
  warsawDateParts,
  createInitialState,
  stateToEmbedData,
  stateToEditableData,
  parseEditableEvents,
  buildEditedState,
  advanceState,
  catchUpState,
  alignStateToCurrentMonth,
  recoverStateFromEmbed,
} = require('../src/utils/rotationState');

describe('canonical rotation state', () => {
  test('uses the Warsaw month at a UTC month boundary', () => {
    const instant = new Date('2026-07-31T22:30:00.000Z'); // 00:30 on 1 August in Warsaw
    expect(warsawDateParts(instant)).toMatchObject({ year: 2026, month: 7, day: 1 });
    expect(stateToEmbedData(createInitialState(instant)).month1Header).toBe('August 2026');
  });

  test('creates two consecutive calendar months', () => {
    const state = createInitialState(new Date('2026-12-10T12:00:00Z'));
    const rendered = stateToEmbedData(state);
    expect(rendered.month1Header).toBe('December 2026');
    expect(rendered.month2Header).toBe('January 2027');
  });

  test('preserves the map cycle across month boundaries', () => {
    const state = createInitialState(new Date('2026-08-07T12:00:00Z'));
    const maps = state.months.flatMap(month => month.events.map(event => event.map));
    maps.forEach((map, index) => expect(map).toBe(MAP_CYCLE[index % MAP_CYCLE.length]));
  });

  test('rejects impossible calendar dates', () => {
    expect(() => parseEditableEvents('31/02/2026 - Utah', { year: 2026, month: 1 }, 'Month 1'))
      .toThrow('invalid calendar date');
  });

  test('rejects events outside their displayed month', () => {
    expect(() => parseEditableEvents('01/09/2026 - Utah', { year: 2026, month: 7 }, 'Month 1'))
      .toThrow('must be in August 2026');
  });

  test('rejects duplicate and unsorted dates', () => {
    expect(() => parseEditableEvents('05/08/2026 - Utah\n05/08/2026 - SMDM', { year: 2026, month: 7 }, 'Month 1'))
      .toThrow('duplicate date');
    expect(() => parseEditableEvents('12/08/2026 - Utah\n05/08/2026 - SMDM', { year: 2026, month: 7 }, 'Month 1'))
      .toThrow('ascending order');
  });

  test('rejects non-consecutive month headers', () => {
    const state = createInitialState(new Date('2026-08-07T12:00:00Z'));
    expect(() => buildEditedState({
      month1Header: 'August 2026', month1Events: '— No events scheduled —',
      month2Header: 'October 2026', month2Events: '— No events scheduled —',
    }, state)).toThrow('immediately after Month 1');
  });

  test('rejects rendered fields above Discord limits', () => {
    const state = createInitialState(new Date('2026-08-07T12:00:00Z'));
    const lines = Array.from({ length: 31 }, (_, index) =>
      `${String(index + 1).padStart(2, '0')}/08/2026 - ${'X'.repeat(70)}`
    ).join('\n');
    expect(() => buildEditedState({
      month1Header: 'August 2026', month1Events: lines,
      month2Header: 'September 2026', month2Events: '— No events scheduled —',
    }, state)).toThrow('Discord allows 1024');
  });

  test('increments revision on edit and advance', () => {
    const initial = createInitialState(new Date('2026-08-07T12:00:00Z'));
    const editable = { ...stateToEditableData(initial), eventTime: '19:30' };
    const edited = buildEditedState(editable, initial);
    const advanced = advanceState(edited);
    expect(edited.revision).toBe(initial.revision + 1);
    expect(advanced.revision).toBe(edited.revision + 1);
    expect(advanced.months[1].events.every(event => event.time === '19:30')).toBe(true);
  });

  test('catches up several missed months in one operation', () => {
    const old = createInitialState(new Date('2026-01-10T12:00:00Z'));
    const result = catchUpState(old, new Date('2026-08-07T12:00:00Z'));
    expect(result.advances).toBe(7);
    expect(result.stillBehind).toBe(false);
    expect(stateToEmbedData(result.state).month1Header).toBe('August 2026');
  });

  test('caps catch-up to protect against corrupt or extremely old state', () => {
    const old = createInitialState(new Date('2020-01-10T12:00:00Z'));
    const result = catchUpState(old, new Date('2026-08-07T12:00:00Z'));
    expect(result.advances).toBe(24);
    expect(result.stillBehind).toBe(true);
  });

  test('realigns a prematurely advanced rotation to the current Warsaw month', () => {
    const august = createInitialState(new Date('2026-08-07T12:00:00Z'));
    const september = advanceState(august);
    const result = alignStateToCurrentMonth(september, new Date('2026-08-07T12:00:00Z'));
    expect(result.reset).toBe(true);
    expect(result.state.revision).toBe(september.revision + 1);
    expect(stateToEmbedData(result.state).month1Header).toBe('August 2026');
  });

  test('recovers canonical state from an existing embed', () => {
    const original = createInitialState(new Date('2026-08-07T12:00:00Z'));
    const data = stateToEmbedData(original);
    const recovered = recoverStateFromEmbed({
      fields: [
        { name: data.month1Header, value: data.month1Events },
        { name: data.month2Header, value: data.month2Events },
      ],
    }, 'message-1');
    expect(recovered.messageId).toBe('message-1');
    expect(stateToEmbedData(recovered)).toMatchObject(data);
  });
});
