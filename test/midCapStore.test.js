const fs = require('fs');
const os = require('os');
const path = require('path');

describe('midCapStore', () => {
  let store;
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-midcap-'));
    process.env.DATA_DIR = dir;
    jest.resetModules();
    store = require('../src/utils/midCapStore');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  const KEY = () => store.matchKey('2026-08-12', 'Carentan');

  test('starts empty and round-trips a vote', async () => {
    expect(store.loadBallots(KEY())).toEqual({});
    const result = await store.castVote(KEY(), 'u1', 'allies', 'Town Center');
    expect(result).toMatchObject({ action: 'added', saved: true });
    expect(store.loadBallots(KEY()).u1).toMatchObject({ cap: 'Town Center', team: 'allies' });
  });

  test('ballots are scoped per match, so a new map starts clean', async () => {
    await store.castVote(KEY(), 'u1', 'allies', 'Town Center');
    expect(store.loadBallots(store.matchKey('2026-08-19', 'Utah'))).toEqual({});
    expect(store.loadBallots(store.matchKey('2026-08-12', 'Utah'))).toEqual({});
  });

  test('concurrent votes are all recorded (no lost updates)', async () => {
    const voters = Array.from({ length: 25 }, (_, i) => `u${i}`);
    await Promise.all(voters.map(id => store.castVote(KEY(), id, 'axis', 'Train Station')));
    expect(Object.keys(store.loadBallots(KEY()))).toHaveLength(25);
  });

  test('a second click on the same cap retracts, through the store', async () => {
    await store.castVote(KEY(), 'u1', 'allies', 'Town Center');
    const result = await store.castVote(KEY(), 'u1', 'allies', 'Town Center');
    expect(result.action).toBe('retracted');
    expect(store.loadBallots(KEY())).toEqual({});
  });

  test('old polls are pruned but the active one is always kept', async () => {
    for (let day = 1; day <= store.POLL_LIMIT + 3; day++) {
      const key = store.matchKey(`2026-03-${String(day).padStart(2, '0')}`, 'Utah');
      await store.castVote(key, 'u1', 'allies', 'WN4');
    }
    const polls = JSON.parse(fs.readFileSync(path.join(dir, 'midcap_votes.json'), 'utf8')).polls;
    expect(Object.keys(polls)).toHaveLength(store.POLL_LIMIT);
    // The newest key survived; the oldest did not.
    expect(polls[store.matchKey('2026-03-11', 'Utah')]).toBeDefined();
    expect(polls[store.matchKey('2026-03-01', 'Utah')]).toBeUndefined();
  });

  test('clearBallots removes one poll and reports whether it existed', async () => {
    await store.castVote(KEY(), 'u1', 'allies', 'Town Center');
    await expect(store.clearBallots(KEY())).resolves.toBe(true);
    expect(store.loadBallots(KEY())).toEqual({});
    await expect(store.clearBallots(KEY())).resolves.toBe(false);
  });

  test('the message pointer round-trips independently of ballots', async () => {
    expect(store.loadCapMessage()).toBeNull();
    store.saveCapMessage('chan-1', 'msg-1');
    await store.castVote(KEY(), 'u1', 'allies', 'Town Center');
    expect(store.loadCapMessage()).toEqual({ channelId: 'chan-1', messageId: 'msg-1' });
    expect(store.clearCapMessage()).toBe(true);
    expect(store.loadCapMessage()).toBeNull();
    // Clearing the pointer must not drop the votes.
    expect(store.loadBallots(KEY()).u1).toBeDefined();
  });

  test('a corrupt file degrades to an empty poll instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'midcap_votes.json'), '{ not json', 'utf8');
    jest.resetModules();
    const reloaded = require('../src/utils/midCapStore');
    expect(reloaded.loadBallots(KEY())).toEqual({});
    expect(reloaded.loadCapMessage()).toBeNull();
  });

  test('data survives a module reload from disk', async () => {
    await store.castVote(KEY(), 'u1', 'allies', 'Town Center');
    jest.resetModules();
    const reloaded = require('../src/utils/midCapStore');
    expect(reloaded.loadBallots(reloaded.matchKey('2026-08-12', 'Carentan')).u1).toBeDefined();
  });
});
