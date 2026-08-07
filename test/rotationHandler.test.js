/**
 * upsertRotation recovery — when the stored message pointer is stale
 * (message deleted on Discord), the bot must post a fresh rotation embed
 * instead of crashing with DiscordAPIError 10008.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('upsertRotation with a stale message pointer', () => {
  let upsertRotation;
  let rotationStore;
  let rotationState;
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-rotation-handler-'));
    process.env.DATA_DIR = dir;
    process.env.MAP_ROTATION_CHANNEL = 'rot-ch';
    jest.resetModules();
    ({ upsertRotation } = require('../src/handlers/interactions/rotationHandler'));
    rotationStore = require('../src/utils/rotationStore');
    rotationState = require('../src/utils/rotationState');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  function emptyCollection() {
    const a = [];
    a.first = () => null;
    a.filter = () => emptyCollection();
    return a;
  }

  test('posts a fresh embed and re-points the store when the old message is gone', async () => {
    // Stored state claims the rotation lives at message 'stale-1'…
    const state = rotationState.createInitialState(new Date('2026-08-07T12:00:00Z'));
    state.messageId = 'stale-1';
    rotationStore.saveRotationState('rot-ch', state);
    rotationStore.saveRotationMsgId('rot-ch', 'stale-1');

    const send = jest.fn(async () => ({ id: 'fresh-1' }));
    const channel = {
      id: 'rot-ch',
      isTextBased: () => true,
      client: { user: { id: 'bot-id' } },
      send,
      messages: {
        fetch: jest.fn(async opts => {
          // Live Discord says 10008 for the pointer; channel scan finds nothing.
          if (opts && opts.message) {
            const err = new Error('Unknown Message');
            err.code = 10008;
            throw err;
          }
          return emptyCollection();
        }),
      },
    };
    const client = {
      user: { id: 'bot-id' },
      channels: { fetch: jest.fn(async () => channel) },
    };

    const result = await upsertRotation(client, rotationState.createInitialState(new Date('2026-08-07T12:00:00Z')));

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1); // posted fresh, no crash
    expect(result.state.messageId).toBe('fresh-1');
    expect(rotationStore.loadRotationState('rot-ch').messageId).toBe('fresh-1');
  });
});
