const fs = require('fs');
const os = require('os');
const path = require('path');

describe('signupStore', () => {
  let store;
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-signups-'));
    process.env.DATA_DIR = dir;
    jest.resetModules();
    store = require('../src/utils/signupStore');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  test('starts empty with auto-post off', () => {
    expect(store.getState()).toEqual({ auto_post: false, category_id: null, channels: {}, events: {} });
  });

  test('auto-post toggle round-trips', () => {
    expect(store.setAutoPost(true)).toBe(true);
    expect(store.getState().auto_post).toBe(true);
    store.setAutoPost(false);
    expect(store.getState().auto_post).toBe(false);
  });

  test('category and channels persist', () => {
    store.setCategoryId('111');
    store.setChannel('OKT', '222');
    store.setChannel(store.SOLO_KEY, '333');
    const state = store.getState();
    expect(state.category_id).toBe('111');
    expect(state.channels).toEqual({ OKT: '222', [store.SOLO_KEY]: '333' });
  });

  test('recorded events make posting idempotent per (date, key)', () => {
    expect(store.getEvent('2026-08-19', 'OKT')).toBeNull();
    store.recordEvent('2026-08-19', 'OKT', { id: 'ev1', channelId: 'ch1' });
    expect(store.getEvent('2026-08-19', 'OKT')).toEqual({ id: 'ev1', channelId: 'ch1' });
    // a different date or clan is unaffected
    expect(store.getEvent('2026-08-26', 'OKT')).toBeNull();
    expect(store.getEvent('2026-08-19', 'TLL')).toBeNull();
  });

  test('eventsForDate returns a copy of all recorded events', () => {
    store.recordEvent('2026-08-19', 'OKT', { id: 'ev1', channelId: 'ch1' });
    store.recordEvent('2026-08-19', store.SOLO_KEY, { id: 'ev2', channelId: 'ch2' });
    const events = store.eventsForDate('2026-08-19');
    expect(Object.keys(events).sort()).toEqual(['OKT', store.SOLO_KEY].sort());
    // mutating the copy must not leak into the store
    delete events.OKT;
    expect(store.getEvent('2026-08-19', 'OKT')).not.toBeNull();
  });

  test('clearEvent removes the entry and drops empty date buckets', () => {
    store.recordEvent('2026-08-19', 'OKT', { id: 'ev1', channelId: 'ch1' });
    store.clearEvent('2026-08-19', 'OKT');
    expect(store.getEvent('2026-08-19', 'OKT')).toBeNull();
    expect(store.getState().events).toEqual({});
  });

  test('a corrupt file degrades to the empty state instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'signups_data.json'), '{not json', 'utf8');
    expect(store.getState()).toEqual({ auto_post: false, category_id: null, channels: {}, events: {} });
  });
});
