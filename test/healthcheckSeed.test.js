/**
 * Healthcheck now owns both directions of cache hygiene: clearing pointers whose
 * message is gone, and recording embeds that are posted but untracked.
 *
 * The second half used to happen as a side effect of drawing the panel. Moving it
 * here kept the write out of the render path — which now runs after every admin
 * action — at the cost of the first Edit after a restart doing one extra scan.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let dir;
let healthcheck;
let lineupStore;

const BOT_ID = 'bot-1';

function message(id, embed) {
  return { id, author: { id: BOT_ID }, embeds: [embed] };
}

function channel(history) {
  return {
    isTextBased: () => true,
    client: { user: { id: BOT_ID } },
    messages: { fetch: jest.fn(async () => history) },
  };
}

function client(channels) {
  return {
    user: { id: BOT_ID },
    channels: { fetch: jest.fn(async id => channels[id] ?? null) },
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-hcseed-'));
  process.env.DATA_DIR = dir;
  process.env.LINEUP_CHANNEL = 'lineup-ch';
  process.env.SERVER_DETAILS_CHANNEL = 'srv-ch';
  jest.resetModules();
  healthcheck = require('../src/utils/healthcheck');
  lineupStore = require('../src/utils/lineupStore');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.LINEUP_CHANNEL;
  delete process.env.SERVER_DETAILS_CHANNEL;
});

test('records the posted embeds the cache had lost track of', async () => {
  const lineup = channel([
    message('l1', { image: { url: 'x' }, description: 'MWF **Server 1**' }),
    message('l2', { image: { url: 'x' }, description: 'MWF **Server 2**' }),
  ]);
  const server = channel([
    message('s1', { title: 'Server Details (S1)', fields: [
      { name: '📌 Server Name', value: 'HCIA EU 1' },
      { name: '🔒 Password', value: 'MWFTIME' },
    ] }),
  ]);

  const seeded = await healthcheck.seedMissingPointers(client({ 'lineup-ch': lineup, 'srv-ch': server }));

  expect(seeded).toBe(3);
  expect(lineupStore.loadLineupData('lineup-ch', 'S1').messageId).toBe('l1');
  expect(lineupStore.loadLineupData('lineup-ch', 'S2').messageId).toBe('l2');
  // The values the Edit modal prefills with come from the embed's own fields.
  expect(lineupStore.loadServerData('srv-ch', 'S1')).toMatchObject({
    messageId: 's1', serverName: 'HCIA EU 1', serverPassword: 'MWFTIME',
  });
});

test('leaves an existing pointer alone — clearing dead ones is the other pass', async () => {
  lineupStore.saveLineupData('lineup-ch', 'already-known', 'caption', 'S1');
  const lineup = channel([message('newer', { image: { url: 'x' }, description: '**Server 1**' })]);

  const seeded = await healthcheck.seedMissingPointers(client({ 'lineup-ch': lineup }));

  expect(seeded).toBe(0);
  expect(lineupStore.loadLineupData('lineup-ch', 'S1').messageId).toBe('already-known');
});

test('an unreachable channel costs nothing', async () => {
  const exploding = {
    user: { id: BOT_ID },
    channels: { fetch: async () => { throw new Error('Missing Access'); } },
  };

  await expect(healthcheck.seedMissingPointers(exploding)).resolves.toBe(0);
});
