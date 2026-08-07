const fs = require('fs');
const os = require('os');
const path = require('path');

describe('lineupStore', () => {
  let store;
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-lineup-'));
    process.env.DATA_DIR = dir;
    jest.resetModules();
    store = require('../src/utils/lineupStore');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  test('lineup captions round-trip and keys are per-server', () => {
    store.saveLineupData('chan1', 'msg-s1', 'caption S1', 'S1');
    store.saveLineupData('chan1', 'msg-s2', 'caption S2', 'S2');
    store.saveLineupData('chan1', 'msg-legacy', 'caption legacy');

    expect(store.loadLineupData('chan1', 'S1')).toMatchObject({ messageId: 'msg-s1', caption: 'caption S1', server: 'S1' });
    expect(store.loadLineupData('chan1', 'S2')).toMatchObject({ messageId: 'msg-s2', caption: 'caption S2', server: 'S2' });
    expect(store.loadLineupData('chan1')).toMatchObject({ messageId: 'msg-legacy', server: null });
    expect(store.loadLineupData('other-channel', 'S1')).toBeNull();
  });

  test('clearLineupData reports whether something was removed', () => {
    store.saveLineupData('chan2', 'msg-a', 'cap', 'S1');
    expect(store.clearLineupData('chan2', 'S1')).toBe(true);
    expect(store.clearLineupData('chan2', 'S1')).toBe(false);
    expect(store.loadLineupData('chan2', 'S1')).toBeNull();
  });

  test('server details round-trip independently of lineup captions', () => {
    store.saveServerData('chan3', 'msg-srv', 'My Server', 'hunter2', 'S1');
    expect(store.loadServerData('chan3', 'S1')).toEqual({
      messageId: 'msg-srv', serverName: 'My Server', serverPassword: 'hunter2', server: 'S1',
    });
    expect(store.loadServerData('chan3', 'S2')).toBeNull();
    expect(store.clearServerData('chan3', 'S1')).toBe(true);
    expect(store.clearServerData('chan3', 'S1')).toBe(false);
  });

  test('data survives a module reload from disk', () => {
    store.saveLineupData('chan-persist', 'msg-p', 'persistent', 'S1');
    jest.resetModules();
    const reloaded = require('../src/utils/lineupStore');
    expect(reloaded.loadLineupData('chan-persist', 'S1')).toMatchObject({ messageId: 'msg-p' });
  });
});
