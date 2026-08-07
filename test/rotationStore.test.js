const fs = require('fs');
const os = require('os');
const path = require('path');

describe('rotation history and backups', () => {
  test('keeps undo history and restores without creating a duplicate history entry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-rotation-'));
    process.env.DATA_DIR = dir;
    jest.resetModules();
    const store = require('../src/utils/rotationStore');
    const base = {
      version: 1, revision: 1, messageId: 'm1', nextMapIndex: 0,
      months: [{ year: 2026, month: 7, events: [] }, { year: 2026, month: 8, events: [] }],
    };
    store.saveRotationState('channel', base);
    store.saveRotationState('channel', { ...base, revision: 2, nextMapIndex: 1 });
    store.saveRotationState('channel', { ...base, revision: 3, nextMapIndex: 2 });
    expect(store.rotationHistoryCount('channel')).toBe(2);

    const restored = store.restorePreviousRotationState('channel');
    expect(restored.nextMapIndex).toBe(1);
    expect(restored.revision).toBe(4);
    expect(store.rotationHistoryCount('channel')).toBe(1);
    expect(fs.readdirSync(path.join(dir, 'backups')).length).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });
});
