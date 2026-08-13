/**
 * postAllHandler.js — "Post all missing" admin action.
 *
 * Iterates every embed tracked on the panel and publishes a default version
 * of each one that is currently 🔴. Reuses the panel probes so we don't
 * double-post an embed that already exists in the channel.
 *
 * Note: Lineup embeds need an image attachment and therefore cannot be
 * auto-posted from the panel. Missing lineups are reported in the summary
 * so admins know to run /lineup manually.
 */

const { EmbedBuilder } = require('discord.js');

const logger = require('../../utils/logger');
const { COLORS } = require('../../config/theme');
const { createFactionEmbed, createServerDetailsEmbed } = require('../../utils/embeds');
const { createFactionButtons } = require('../../utils/buttons');
const { sendLog, bulkDeleteFiltered, hasEmbedTitle } = require('./shared');
const { THUMBNAIL_URL, DEFAULT_NODES, EMBED_TITLES } = require('../../config/constants');
const { getServerDefaults } = require('../../config/runtime');
const { saveServerData } = require('../../utils/lineupStore');
const { saveNodesData }  = require('../../utils/nodesStore');
const { ensureRotationPosted } = require('./rotationHandler');
const { ensureMidCapPoll }     = require('./midCapHandler');

const { probePanelState } = require('../../panel/probes');
const { ackPanelAction, reportPanelResult } = require('../../panel/respond');

// ── Cores (each returns { posted: true|false, reason?: string }) ─────────────

async function postFactionCore(client) {
  const channelId = process.env.FACTION_CHANNEL;
  if (!channelId) return { posted: false, reason: 'FACTION_CHANNEL not set' };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return { posted: false, reason: 'Faction channel unreachable' };
  const isFactionEmbed = hasEmbedTitle(EMBED_TITLES.faction);
  await bulkDeleteFiltered(
    channel,
    msg => msg.author.id === client.user.id && isFactionEmbed(msg)
  );
  await channel.send({ embeds: [createFactionEmbed()], components: [createFactionButtons()] });
  return { posted: true };
}

async function postServerCore(client, server) {
  const channelId = process.env.SERVER_DETAILS_CHANNEL;
  if (!channelId) return { posted: false, reason: 'SERVER_DETAILS_CHANNEL not set' };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return { posted: false, reason: 'Server Details channel unreachable' };

  const { defaultName, defaultPass } = getServerDefaults(server);
  const embed = createServerDetailsEmbed(server, defaultName, defaultPass);

  // Send without button — the edit button is re-wired via stored messageId
  // on modal open, matching the regular postServerCore handler behavior.
  const msg = await channel.send({ embeds: [embed] });
  saveServerData(channel.id, msg.id, defaultName, defaultPass, server);
  return { posted: true };
}

async function postRotationCore(client) {
  const result = await ensureRotationPosted(client);
  return result.ok
    ? { posted: true }
    : { posted: false, reason: result.reason || 'Rotation upsert failed' };
}

async function postMidCapCore(client) {
  const result = await ensureMidCapPoll(client);
  return result.ok
    ? { posted: true }
    : { posted: false, reason: result.reason || 'Mid cap poll failed' };
}

async function postNodesCore(client, channelIds = null) {
  const configuredIds = (process.env.NODES_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ids = channelIds ?? configuredIds;
  if (!configuredIds.length) return { posted: false, reason: 'NODES_CHANNELS not set' };
  if (!ids.length) return { posted: false, reason: 'No missing Nodes channels' };

  let ok = 0;
  let fail = 0;
  for (const channelId of ids) {
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = new EmbedBuilder()
        .setTitle(EMBED_TITLES.nodes)
        .setColor(COLORS.primary)
        .setThumbnail(THUMBNAIL_URL)
        .addFields(DEFAULT_NODES);
      await channel.send({ embeds: [embed] });
      ok++;
    } catch (err) {
      fail++;
      logger.error(`postNodesCore failed for channel ${channelId}: ${err.message}`);
    }
  }
  saveNodesData(DEFAULT_NODES);
  return { posted: ok > 0, ok, fail, total: ids.length };
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function handleAdminPostAllMissing(interaction) {
  await ackPanelAction(interaction);

  const state = await probePanelState(interaction.client);

  const needsFaction  = !state.faction;
  const needsLineupS1 = !state.lineupS1;
  const needsLineupS2 = !state.lineupS2;
  const needsServerS1 = !state.serverS1;
  const needsServerS2 = !state.serverS2;
  const needsRotation = !state.rotation;
  const needsNodes    = !state.nodes || state.nodes.hits.length < state.nodes.total;
  // Only when the feature is configured and a match is actually scheduled.
  const needsMidCap   = Boolean(process.env.MIDCAP_CHANNEL) && Boolean(state.midcap?.match) && !state.midcap.locator;

  const results = [];

  if (needsFaction) {
    const r = await postFactionCore(interaction.client);
    results.push({ label: 'Faction Embed', ...r });
  }
  if (needsServerS1) {
    const r = await postServerCore(interaction.client, 'S1');
    results.push({ label: 'Server Details — S1', ...r });
  }
  if (needsServerS2) {
    const r = await postServerCore(interaction.client, 'S2');
    results.push({ label: 'Server Details — S2', ...r });
  }
  if (needsRotation) {
    const r = await postRotationCore(interaction.client);
    results.push({ label: 'Map Rotation', ...r });
  }
  if (needsMidCap) {
    const r = await postMidCapCore(interaction.client);
    results.push({ label: 'Mid Cap Poll', ...r });
  }
  if (needsNodes) {
    const configuredNodeIds = (process.env.NODES_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean);
    const existingNodeIds = new Set((state.nodes?.hits || []).map(hit => hit.channelId));
    const missingNodeIds = configuredNodeIds.filter(id => !existingNodeIds.has(id));
    const r = await postNodesCore(interaction.client, missingNodeIds);
    const extra = r.total ? ` (${r.ok}/${r.total})` : '';
    results.push({ label: 'Nodes' + extra, ...r });
  }

  const skipped = [];
  if (needsLineupS1) skipped.push('Lineup S1 — needs image via `/lineup`');
  if (needsLineupS2) skipped.push('Lineup S2 — needs image via `/lineup`');

  const posted = results.filter(r => r.posted).map(r => `✅ ${r.label}`);
  const failed = results.filter(r => !r.posted).map(r => `❌ ${r.label} — ${r.reason || 'failed'}`);

  const summaryLines = [];
  if (posted.length)  summaryLines.push(...posted);
  if (failed.length)  summaryLines.push(...failed);
  if (skipped.length) summaryLines.push(...skipped.map(s => `⏭️ ${s}`));
  if (!summaryLines.length) summaryLines.push('Nothing was missing — everything is already posted.');

  logger.info(`${interaction.user.tag} ran Post All Missing — posted ${posted.length}, failed ${failed.length}, skipped ${skipped.length}`);

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📮 Post All Missing')
    .addFields(
      { name: '👤 Admin',   value: `<@${interaction.user.id}>`, inline: true },
      { name: '✅ Posted',  value: `${posted.length}`,           inline: true },
      { name: '❌ Failed',  value: `${failed.length}`,           inline: true }
    )
    .setDescription(summaryLines.join('\n').slice(0, 2000))
    .setTimestamp()
  );

  const color = failed.length ? COLORS.warning : COLORS.success;
  return reportPanelResult(interaction, {
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(posted.length ? '📮 Post All Missing' : 'Post All Missing')
      .setDescription(summaryLines.join('\n').slice(0, 4000))]
  });
}

module.exports = { handleAdminPostAllMissing };
