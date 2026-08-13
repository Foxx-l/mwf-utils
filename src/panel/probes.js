// @ts-check
/**
 * probes.js — What is actually posted in Discord right now.
 *
 * Each probe verifies one embed against Discord and returns either `null` (not
 * posted) or a locator `{ channelId, messageId }`. Probes catch their own errors
 * and degrade to `null` so drawing the panel can never throw; the cost is that
 * an unreachable channel looks exactly like "not posted", which is what the
 * Healthcheck action exists to tell apart.
 *
 * Probes are **reads**. They used to write the lineup/server caches back on
 * every draw, which meant opening the panel had side effects — and with the
 * panel now redrawing after every action, that would have doubled. The two
 * cache readers recover on their own when they find nothing (see
 * handleAdminEditCaption / handleAdminEditServer), and the healthcheck handles
 * the opposite case of a pointer whose message is gone.
 */

const { loadLineupData, loadServerData } = require('../utils/lineupStore');
const { loadRotationMsgId, loadRotationState, rotationHistoryCount } = require('../utils/rotationStore');
const { matchKey, loadPoll } = require('../utils/midCapStore');
const { getMatch } = require('../handlers/interactions/midCapHandler');
const { findLastBotMessage, hasEmbedTitle, hasLineupImageFor } = require('../handlers/interactions/shared');
const { EMBED_TITLES } = require('../config/constants');

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

/**
 * The one probe algorithm: trust the cached pointer if its message is still
 * there, otherwise scan the channel's recent history for the embed itself.
 * @param {*} client
 * @param {{ channelId: string|undefined, cachedId?: string, predicate: (m: *) => boolean }} opts
 * @returns {Promise<PanelLocator|null>}
 */
async function probeCachedOrScan(client, { channelId, cachedId, predicate }) {
  if (!channelId) return null;
  try {
    const cached = await messageLocator(client, channelId, cachedId);
    if (cached) return cached;

    const channel = await client.channels.fetch(channelId);
    if (!channel) return null;
    const match = await findLastBotMessage(channel, predicate);
    return match ? { channelId, messageId: match.id } : null;
  } catch (_) {
    return null;
  }
}

function probeFaction(client) {
  return probeCachedOrScan(client, {
    channelId: process.env.FACTION_CHANNEL,
    predicate: hasEmbedTitle(EMBED_TITLES.faction),
  });
}

function probeLineup(client, server) {
  const channelId = process.env.LINEUP_CHANNEL;
  return probeCachedOrScan(client, {
    channelId,
    cachedId: channelId ? loadLineupData(channelId, server)?.messageId : undefined,
    predicate: hasLineupImageFor(server),
  });
}

function probeServer(client, server) {
  const channelId = process.env.SERVER_DETAILS_CHANNEL;
  return probeCachedOrScan(client, {
    channelId,
    cachedId: channelId ? loadServerData(channelId, server)?.messageId : undefined,
    predicate: hasEmbedTitle(EMBED_TITLES.serverDetails(server)),
  });
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

  // One bad channel must not cost the others: each is probed independently.
  const hits = await Promise.all(channels.map(cid => probeCachedOrScan(client, {
    channelId: cid,
    predicate: hasEmbedTitle(EMBED_TITLES.nodes),
  })));

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
  probeCachedOrScan,
  probeFaction,
  probeLineup,
  probeServer,
  probeRotation,
  probeMidCap,
  probeNodes,
  probePanelState,
};
