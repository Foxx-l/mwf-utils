/**
 * The panel's probes: cached pointer first, channel scan as the fallback, and
 * no writes — drawing the panel must not change stored state, because the panel
 * is now redrawn after every admin action.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let dir;
let probes;
let lineupStore;

const BOT_ID = 'bot-1';

/** A fake message carrying one embed. */
function message(id, embed) {
  return { id, author: { id: BOT_ID }, embeds: [embed] };
}

/**
 * A fake text channel. `messages.fetch(id)` resolves a stored message and
 * `messages.fetch({limit})` returns the history as an array — arrays have the
 * `.find` that findLastBotMessage uses.
 */
function channel(history = [], byId = {}) {
  const ch = {
    client: { user: { id: BOT_ID } },
    messages: {
      fetch: jest.fn(async arg => {
        if (typeof arg === 'string') {
          if (byId[arg]) return byId[arg];
          throw new Error('Unknown Message');
        }
        return history;
      }),
    },
  };
  return ch;
}

function client(channels) {
  return {
    user: { id: BOT_ID },
    channels: { fetch: jest.fn(async id => channels[id] ?? null) },
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-panelprobes-'));
  process.env.DATA_DIR = dir;
  jest.resetModules();
  probes = require('../src/panel/probes');
  lineupStore = require('../src/utils/lineupStore');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.FACTION_CHANNEL;
  delete process.env.LINEUP_CHANNEL;
  delete process.env.SERVER_DETAILS_CHANNEL;
  delete process.env.NODES_CHANNELS;
});

describe('probeFaction', () => {
  test('finds the faction embed in the channel history', async () => {
    process.env.FACTION_CHANNEL = 'faction-ch';
    const ch = channel([message('m1', { title: 'Choose your side!' })]);

    await expect(probes.probeFaction(client({ 'faction-ch': ch })))
      .resolves.toEqual({ channelId: 'faction-ch', messageId: 'm1' });
  });

  test('is null when the embed is not there', async () => {
    process.env.FACTION_CHANNEL = 'faction-ch';
    const ch = channel([message('m1', { title: 'NODES' })]);

    await expect(probes.probeFaction(client({ 'faction-ch': ch }))).resolves.toBeNull();
  });

  test('is null when the channel is unset or unreachable', async () => {
    await expect(probes.probeFaction(client({}))).resolves.toBeNull();

    process.env.FACTION_CHANNEL = 'faction-ch';
    const exploding = { channels: { fetch: async () => { throw new Error('Missing Access'); } } };
    await expect(probes.probeFaction(exploding)).resolves.toBeNull();
  });
});

describe('probeLineup', () => {
  test('a valid cached pointer short-circuits the history scan', async () => {
    process.env.LINEUP_CHANNEL = 'lineup-ch';
    lineupStore.saveLineupData('lineup-ch', 'cached-1', 'caption', 'S1');
    const cached = message('cached-1', { image: { url: 'x' }, description: '**Server 1**' });
    const ch = channel([], { 'cached-1': cached });

    const result = await probes.probeLineup(client({ 'lineup-ch': ch }), 'S1');

    expect(result).toEqual({ channelId: 'lineup-ch', messageId: 'cached-1' });
    // fetch was called with the id only — never with { limit: 50 }.
    expect(ch.messages.fetch).toHaveBeenCalledTimes(1);
    expect(ch.messages.fetch).toHaveBeenCalledWith('cached-1');
  });

  test('a stale pointer falls back to the scan', async () => {
    process.env.LINEUP_CHANNEL = 'lineup-ch';
    lineupStore.saveLineupData('lineup-ch', 'deleted-1', 'caption', 'S2');
    const ch = channel([message('m9', { image: { url: 'x' }, description: 'MWF **Server 2**' })]);

    await expect(probes.probeLineup(client({ 'lineup-ch': ch }), 'S2'))
      .resolves.toEqual({ channelId: 'lineup-ch', messageId: 'm9' });
  });

  test('matches only the requested server', async () => {
    process.env.LINEUP_CHANNEL = 'lineup-ch';
    const ch = channel([message('s1msg', { image: { url: 'x' }, description: '**Server 1**' })]);

    await expect(probes.probeLineup(client({ 'lineup-ch': ch }), 'S2')).resolves.toBeNull();
  });
});

describe('probeServer', () => {
  test('scans for this server’s details embed', async () => {
    process.env.SERVER_DETAILS_CHANNEL = 'srv-ch';
    const ch = channel([message('srv2', { title: 'Server Details (S2)' })]);

    await expect(probes.probeServer(client({ 'srv-ch': ch }), 'S2'))
      .resolves.toEqual({ channelId: 'srv-ch', messageId: 'srv2' });
    await expect(probes.probeServer(client({ 'srv-ch': ch }), 'S1')).resolves.toBeNull();
  });
});

describe('probeNodes', () => {
  test('counts posted channels and keeps the hits', async () => {
    process.env.NODES_CHANNELS = 'n1, n2';
    const withNodes = channel([message('nm1', { title: 'NODES' })]);
    const without = channel([]);

    await expect(probes.probeNodes(client({ n1: withNodes, n2: without }))).resolves.toEqual({
      total: 2,
      hits: [{ channelId: 'n1', messageId: 'nm1' }],
    });
  });

  test('one unreachable channel does not lose the others', async () => {
    process.env.NODES_CHANNELS = 'broken, good';
    const good = channel([message('nm2', { title: 'NODES' })]);
    const c = {
      user: { id: BOT_ID },
      channels: {
        fetch: async id => {
          if (id === 'broken') throw new Error('Missing Access');
          return good;
        },
      },
    };

    await expect(probes.probeNodes(c)).resolves.toEqual({
      total: 2,
      hits: [{ channelId: 'good', messageId: 'nm2' }],
    });
  });

  test('is empty when NODES_CHANNELS is unset', async () => {
    await expect(probes.probeNodes(client({}))).resolves.toEqual({ total: 0, hits: [] });
  });
});

describe('probePanelState', () => {
  test('drawing the panel writes nothing to the stores', async () => {
    process.env.LINEUP_CHANNEL = 'lineup-ch';
    process.env.SERVER_DETAILS_CHANNEL = 'srv-ch';
    const lineup = channel([message('lm', { image: { url: 'x' }, description: '**Server 1**' })]);
    const server = channel([message('sm', { title: 'Server Details (S1)' })]);

    await probes.probePanelState(client({ 'lineup-ch': lineup, 'srv-ch': server }));

    // Both probes found their message by scanning; neither may seed the cache.
    expect(lineupStore.loadLineupData('lineup-ch', 'S1')).toBeNull();
    expect(lineupStore.loadServerData('srv-ch', 'S1')).toBeNull();
  });

  test('returns every key postAllHandler reads', async () => {
    const state = await probes.probePanelState(client({}));

    expect(Object.keys(state).sort()).toEqual([
      'faction', 'lineupS1', 'lineupS2', 'midcap', 'nodes', 'rotation', 'serverS1', 'serverS2',
    ]);
    expect(state.nodes).toEqual({ total: 0, hits: [] });
  });
});
