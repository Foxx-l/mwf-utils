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
  const pointer = { channelId: 'chan-1', messageId: 'msg-1', postedAt: 1 };

  test('starts empty and round-trips a poll pointer', () => {
    expect(store.loadPoll(KEY())).toBeNull();
    expect(store.savePoll(KEY(), pointer)).toBe(true);
    expect(store.loadPoll(KEY())).toEqual(pointer);
  });

  test('pointers are scoped per match, so a new map has no poll', () => {
    store.savePoll(KEY(), pointer);
    expect(store.loadPoll(store.matchKey('2026-08-19', 'Utah'))).toBeNull();
    expect(store.loadPoll(store.matchKey('2026-08-12', 'Utah'))).toBeNull();
  });

  test('markClosed flags a poll once and reports repeat calls', () => {
    store.savePoll(KEY(), pointer);
    expect(store.markClosed(KEY())).toBe(true);
    expect(store.loadPoll(KEY()).closed).toBe(true);
    expect(store.markClosed(KEY())).toBe(false);
    expect(store.markClosed('nope|Map')).toBe(false);
  });

  test('clearPoll removes a pointer so it can be reposted', () => {
    store.savePoll(KEY(), pointer);
    expect(store.clearPoll(KEY())).toBe(true);
    expect(store.loadPoll(KEY())).toBeNull();
    expect(store.clearPoll(KEY())).toBe(false);
  });

  test('listPolls returns matches oldest first', () => {
    store.savePoll(store.matchKey('2026-08-19', 'Utah'), pointer);
    store.savePoll(store.matchKey('2026-08-12', 'Carentan'), pointer);
    expect(store.listPolls().map(([key]) => key)).toEqual([
      '2026-08-12|Carentan',
      '2026-08-19|Utah',
    ]);
  });

  test('old pointers are pruned but the active one is kept', () => {
    for (let day = 1; day <= store.POLL_LIMIT + 3; day++) {
      const key = store.matchKey(`2026-03-${String(day).padStart(2, '0')}`, 'Utah');
      store.savePoll(key, { ...pointer, messageId: `msg-${day}` });
    }
    expect(store.listPolls()).toHaveLength(store.POLL_LIMIT);
    expect(store.loadPoll(store.matchKey('2026-03-11', 'Utah'))).not.toBeNull();
    expect(store.loadPoll(store.matchKey('2026-03-01', 'Utah'))).toBeNull();
  });

  test('a corrupt file degrades to no pointers instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'midcap_polls.json'), '{ not json', 'utf8');
    jest.resetModules();
    const reloaded = require('../src/utils/midCapStore');
    expect(reloaded.loadPoll(KEY())).toBeNull();
    expect(reloaded.listPolls()).toEqual([]);
  });

  test('data survives a module reload from disk', () => {
    store.savePoll(KEY(), pointer);
    jest.resetModules();
    const reloaded = require('../src/utils/midCapStore');
    expect(reloaded.loadPoll(reloaded.matchKey('2026-08-12', 'Carentan'))).toEqual(pointer);
  });
});
