// @ts-check
/**
 * probes.js — What is actually posted in Discord right now.
 *
 * Each probe verifies one embed against Discord and returns either `null` (not
 * posted) or a locator `{ channelId, messageId }`. Probes catch their own errors
 * and degrade to `null` so drawing the panel can never throw; the cost is that
 * an unreachable channel looks exactly like "not posted", which is what the
 * Healthcheck action exists to tell apart.
 */

const { loadLineupData, loadServerData, saveLineupData, saveServerData } = require('../utils/lineupStore');
const { loadRotationMsgId, loadRotationState, rotationHistoryCount } = require('../utils/rotationStore');
const { matchKey, loadPoll } = require('../utils/midCapStore');
const { getMatch } = require('../handlers/interactions/midCapHandler');

/**
 * @typedef {{ channelId: string, messageId: string }} PanelLocator
 */

/**
 * The stored message, if it still exists.
 * @returns {Promise<PanelLocator|null>}
 */
async function messageLocator(client, channelId, messageId) {
  if (!channelId || !messageId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return null;
    const msg = await channel.messages.fetch(messageId);
    return msg ? { channelId, messageId: msg.id } : null;
  } catch (_) {
    return null;
  }
}

async function probeFaction(client) {
  const ch = process.env.FACTION_CHANNEL;
  if (!ch) return null;
  try {
    const channel = await client.channels.fetch(ch);
    if (!channel) return null;
    const msgs = await channel.messages.fetch({ limit: 50 });
    const match = msgs.find(m =>
      m.author.id === client.user.id &&
      m.embeds.some(e => e.title === 'Choose your side!')
    );
    return match ? { channelId: ch, messageId: match.id } : null;
  } catch (_) {
    return null;
  }
}

async function probeLineup(client, server) {
  const channelId = process.env.LINEUP_CHANNEL;
  if (!channelId) return null;
  const data = loadLineupData(channelId, server);
  const cached = await messageLocator(client, channelId, data?.messageId);
  if (cached) return cached;

  try {
    const channel = await client.channels.fetch(channelId);
    const messages = await channel.messages.fetch({ limit: 50 });
    const serverLabel = server === 'S1' ? 'Server 1' : 'Server 2';
    const match = messages.find(m =>
      m.author.id === client.user.id
      && m.embeds.some(e => e.image && e.description?.includes(`**${serverLabel}**`))
    );
    if (!match) return null;
    const caption = match.embeds[0]?.description || '';
    saveLineupData(channelId, match.id, caption, server);
    return { channelId, messageId: match.id };
  } catch (_) {
    return null;
  }
}

async function probeServer(client, server) {
  const channelId = process.env.SERVER_DETAILS_CHANNEL;
  if (!channelId) return null;
  const data = loadServerData(channelId, server);
  const cached = await messageLocator(client, channelId, data?.messageId);
  if (cached) return cached;

  try {
    const channel = await client.channels.fetch(channelId);
    const messages = await channel.messages.fetch({ limit: 50 });
    const expectedTitle = `Server Details (${server})`;
    const match = messages.find(m =>
      m.author.id === client.user.id && m.embeds.some(e => e.title === expectedTitle)
    );
    if (!match) return null;
    const fields = match.embeds[0]?.fields || [];
    const serverName = fields.find(f => f.name.includes('Server Name'))?.value || 'Unknown';
    const serverPassword = fields.find(f => f.name.includes('Password'))?.value || 'Unknown';
    saveServerData(channelId, match.id, serverName, serverPassword, server);
    return { channelId, messageId: match.id };
  } catch (_) {
    return null;
  }
}

async function probeRotation(client) {
  const ch = process.env.MAP_ROTATION_CHANNEL;
  if (!ch) return null;
  const locator = await messageLocator(client, ch, loadRotationMsgId(ch));
  if (!locator) return null;
  const state = loadRotationState(ch);
  return { ...locator, state, historyCount: rotationHistoryCount(ch) };
}

/**
 * Mid cap poll state for the *current* match: a poll from a previous match
 * doesn't count, since each match gets its own (polls can't be edited).
 */
async function probeMidCap(client) {
  const channelId = process.env.MIDCAP_CHANNEL;
  if (!channelId) return null;
  const match = getMatch();
  if (!match) return { match: null, locator: null };
  const pointer = loadPoll(matchKey(match.date, match.map));
  const locator = pointer?.channelId === channelId
    ? await messageLocator(client, channelId, pointer.messageId)
    : null;
  return { match, locator };
}

async function probeNodes(client) {
  const channels = (process.env.NODES_CHANNELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!channels.length) return { total: 0, hits: [] };

  const hits = await Promise.all(channels.map(async cid => {
    try {
      const ch = await client.channels.fetch(cid);
      if (!ch) return null;
      const msgs = await ch.messages.fetch({ limit: 50 });
      const match = msgs.find(m =>
        m.author.id === client.user.id &&
        m.embeds.some(e => e.title === 'NODES')
      );
      return match ? { channelId: cid, messageId: match.id } : null;
    } catch (_) {
      return null;
    }
  }));

  return { total: channels.length, hits: hits.filter(Boolean) };
}

/**
 * Fan-out probe that returns every embed's posted state. Used by the panel
 * renderer and by any admin action that needs to know which embeds are
 * missing (e.g. "Post all missing").
 *
 * The key shape is a contract — postAllHandler reads every one of them.
 */
async function probePanelState(client) {
  const [fac, l1, l2, s1, s2, rot, nodes, midcap] = await Promise.all([
    probeFaction(client),
    probeLineup(client, 'S1'),
    probeLineup(client, 'S2'),
    probeServer(client, 'S1'),
    probeServer(client, 'S2'),
    probeRotation(client),
    probeNodes(client),
    probeMidCap(client)
  ]);
  return { faction: fac, lineupS1: l1, lineupS2: l2, serverS1: s1, serverS2: s2, rotation: rot, nodes, midcap };
}

module.exports = {
  messageLocator,
  probeFaction,
  probeLineup,
  probeServer,
  probeRotation,
  probeMidCap,
  probeNodes,
  probePanelState,
};
