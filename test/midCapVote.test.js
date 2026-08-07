const { tallyVotes, leaders, totals, bar, peak, applyVote, BAR_WIDTH } = require('../src/utils/midCapVote');

const CAPS = ['Canal Crossing', 'Town Center', 'Train Station'];

function ballots(entries) {
  return Object.fromEntries(entries.map(([user, cap, team]) => [user, { cap, team, ts: 0 }]));
}

describe('tallyVotes', () => {
  test('counts per cap and per team, in cap order', () => {
    const tally = tallyVotes(ballots([
      ['u1', 'Town Center', 'allies'],
      ['u2', 'Town Center', 'allies'],
      ['u3', 'Town Center', 'axis'],
      ['u4', 'Canal Crossing', 'axis'],
    ]), CAPS);

    expect(tally).toEqual([
      { cap: 'Canal Crossing', allies: 0, axis: 1, total: 1 },
      { cap: 'Town Center', allies: 2, axis: 1, total: 3 },
      { cap: 'Train Station', allies: 0, axis: 0, total: 0 },
    ]);
  });

  test('ignores ballots for caps that are no longer on offer', () => {
    const tally = tallyVotes(ballots([['u1', 'Some Old Cap', 'allies']]), CAPS);
    expect(totals(tally)).toEqual({ allies: 0, axis: 0 });
  });

  test('ignores ballots with no usable team', () => {
    const tally = tallyVotes(ballots([['u1', 'Town Center', 'spectator']]), CAPS);
    expect(totals(tally)).toEqual({ allies: 0, axis: 0 });
  });

  test('empty and missing ballot boxes are safe', () => {
    expect(totals(tallyVotes({}, CAPS))).toEqual({ allies: 0, axis: 0 });
    expect(totals(tallyVotes(undefined, CAPS))).toEqual({ allies: 0, axis: 0 });
    expect(tallyVotes({}, [])).toEqual([]);
  });
});

describe('leaders', () => {
  const tally = tallyVotes(ballots([
    ['u1', 'Town Center', 'allies'],
    ['u2', 'Canal Crossing', 'axis'],
    ['u3', 'Town Center', 'axis'],
  ]), CAPS);

  test('reports the front runner per team', () => {
    expect(leaders(tally, 'allies')).toEqual(['Town Center']);
  });

  test('reports every cap in a tie rather than picking one', () => {
    expect(leaders(tally, 'axis')).toEqual(['Canal Crossing', 'Town Center']);
  });

  test('is empty when a team has not voted', () => {
    expect(leaders(tallyVotes({}, CAPS), 'allies')).toEqual([]);
  });
});

describe('bar', () => {
  test('scales against the peak and never rounds a real vote down to nothing', () => {
    expect(bar(10, 10)).toBe('█'.repeat(BAR_WIDTH));
    expect(bar(5, 10)).toBe('█████░░░░░');
    expect(bar(1, 100)).toBe('█░░░░░░░░░'); // would round to 0 otherwise
  });

  test('renders empty for no votes or no scale', () => {
    expect(bar(0, 10)).toBe('░'.repeat(BAR_WIDTH));
    expect(bar(3, 0)).toBe('░'.repeat(BAR_WIDTH));
  });

  test('peak is the largest single-team count', () => {
    const tally = tallyVotes(ballots([
      ['u1', 'Town Center', 'allies'],
      ['u2', 'Town Center', 'allies'],
      ['u3', 'Canal Crossing', 'axis'],
    ]), CAPS);
    expect(peak(tally)).toBe(2);
    expect(peak(tallyVotes({}, CAPS))).toBe(0);
  });
});

describe('applyVote', () => {
  test('adds a first vote', () => {
    const result = applyVote({}, 'u1', 'allies', 'Town Center', 5);
    expect(result.action).toBe('added');
    expect(result.previousCap).toBeNull();
    expect(result.ballots.u1).toEqual({ cap: 'Town Center', team: 'allies', ts: 5 });
  });

  test('moves an existing vote to another cap', () => {
    const first = applyVote({}, 'u1', 'allies', 'Town Center');
    const second = applyVote(first.ballots, 'u1', 'allies', 'Train Station');
    expect(second.action).toBe('moved');
    expect(second.previousCap).toBe('Town Center');
    expect(second.ballots.u1.cap).toBe('Train Station');
    expect(Object.keys(second.ballots)).toHaveLength(1); // still one vote each
  });

  test('clicking the same cap again retracts the vote', () => {
    const first = applyVote({}, 'u1', 'allies', 'Town Center');
    const second = applyVote(first.ballots, 'u1', 'allies', 'Town Center');
    expect(second.action).toBe('retracted');
    expect(second.ballots.u1).toBeUndefined();
  });

  test('a switched faction role re-attributes the vote', () => {
    const first = applyVote({}, 'u1', 'allies', 'Town Center');
    const second = applyVote(first.ballots, 'u1', 'axis', 'Train Station');
    expect(second.ballots.u1.team).toBe('axis');
    expect(totals(tallyVotes(second.ballots, CAPS))).toEqual({ allies: 0, axis: 1 });
  });

  test('does not mutate the ballots it was given', () => {
    const original = ballots([['u1', 'Town Center', 'allies']]);
    const snapshot = JSON.stringify(original);
    applyVote(original, 'u2', 'axis', 'Train Station');
    applyVote(original, 'u1', 'allies', 'Town Center');
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
