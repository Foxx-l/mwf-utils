const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const {
  loadLineupData,
  loadServerData,
  saveLineupData,
  saveServerData,
} = require('../../utils/lineupStore');
const { loadRotationMsgId, loadRotationState, rotationHistoryCount } = require('../../utils/rotationStore');
const { monthHeader }                     = require('../../utils/rotationState');
const { matchKey, loadPoll }              = require('../../utils/midCapStore');
const { getMatch }                        = require('../../handlers/interactions/midCapHandler');
const { COLORS }                          = require('../../config/theme');
const { loadLastAction }                 = require('../../utils/lastActionStore');
const { getNextResetTime }               = require('../../utils/scheduler');
const { signupsPanelRow }                = require('../../handlers/interactions/signupHandler');
const pkg = require('../../../package.json');

// ── Required env vars (warns if any are missing) ─────────────────────────────
// Each entry is either a single string (required) or an array of two+
// strings (any one of which satisfies the check — used for legacy fallback).
const REQUIRED_ENV_VARS = [
  'GUILD_ID',
  'FACTION_CHANNEL',
  'LINEUP_CHANNEL',
  'SERVER_DETAILS_CHANNEL',
  'MAP_ROTATION_CHANNEL',
  'NODES_CHANNELS',
  ['SERVER_S1_NAME',     'SERVER_NAME'],
  ['SERVER_S1_PASSWORD', 'SERVER_PASSWORD'],
  ['SERVER_S2_NAME',     'SERVER_NAME'],
  ['SERVER_S2_PASSWORD', 'SERVER_PASSWORD']
];

function listMissingEnv() {
  return REQUIRED_ENV_VARS.filter(entry => {
    const keys = Array.isArray(entry) ? entry : [entry];
    return !keys.some(k => process.env[k] && String(process.env[k]).trim() !== '');
  }).map(entry => Array.isArray(entry) ? entry[0] : entry);
}

const OK = '🟢';
const NO = '🔴';
const PARTIAL = '🟡';
const BOT_STARTED_AT_MS = Date.now();

function humanizeAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function jumpUrl(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function channelUrl(guildId, channelId) {
  if (!guildId || !channelId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function jumpSuffix(guildId, channelId, messageId) {
  const url = jumpUrl(guildId, channelId, messageId);
  return url ? `  [↗](${url})` : '';
}

// Fallback suffix used when there is no posted message yet — link to the
// destination channel so the admin can jump to where the embed *would*
// appear once posted. Returns '' when channelId is unknown.
function channelSuffix(guildId, channelId) {
  const url = channelUrl(guildId, channelId);
  return url ? `  [↗](${url})` : '';
}

function firstChannel(envKey) {
  const raw = process.env[envKey];
  if (!raw) return null;
  return String(raw).split(',').map(s => s.trim()).find(Boolean) ?? null;
}

// ── Status probes ────────────────────────────────────────────────────────────
// Each probe verifies state against Discord and returns either null (not
// posted) or a small locator object. Probes catch their own errors and
// degrade to null so the panel never throws.

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

// ── Description rows ─────────────────────────────────────────────────────────

// Prefer a direct message jump when available; otherwise fall back to the
// destination channel so admins always get a clickable target.
function bestSuffix(guildId, locator, fallbackChannelId) {
  if (locator) return jumpSuffix(guildId, locator.channelId, locator.messageId);
  return channelSuffix(guildId, fallbackChannelId);
}

function factionRow(locator, guildId) {
  const ch = process.env.FACTION_CHANNEL;
  const icon = locator ? OK : NO;
  return `🛡️ **Faction Embed**   ${icon}${bestSuffix(guildId, locator, ch)}`;
}

function serverPairRow(emojiLabel, l1, l2, guildId, envKey) {
  const ch = process.env[envKey];
  if (!ch) return `${emojiLabel}   ${NO}`;
  const s1 = `${l1 ? OK : NO}${bestSuffix(guildId, l1, ch)}`;
  const s2 = `${l2 ? OK : NO}${bestSuffix(guildId, l2, ch)}`;
  return `${emojiLabel}   S1 ${s1} • S2 ${s2}`;
}

function rotationRow(locator, guildId) {
  const ch = process.env.MAP_ROTATION_CHANNEL;
  if (!locator) return `🗺️ **Map Rotation**   ${NO}${channelSuffix(guildId, ch)}`;
  const months = locator.state?.months;
  const window = months?.length === 2
    ? `${monthHeader(months[0].year, months[0].month)} / ${monthHeader(months[1].year, months[1].month)}`
    : 'state recovering';
  const history = locator.historyCount ? ` • ${locator.historyCount} undo` : '';
  return `🗺️ **Map Rotation**   ${OK}${bestSuffix(guildId, locator, ch)}   _${window}${history}_`;
}

function midCapRow(state, guildId) {
  const ch = process.env.MIDCAP_CHANNEL;
  if (!ch || !state) return null; // feature not configured — keep the panel clean
  if (!state.match) return `📊 **Mid Cap Poll**   ${NO}${channelSuffix(guildId, ch)}   _no scheduled match_`;
  const icon = state.locator ? OK : NO;
  const note = state.match.live ? 'live · voting closed' : state.match.map;
  return `📊 **Mid Cap Poll**   ${icon}${bestSuffix(guildId, state.locator, ch)}   _${note}_`;
}

function nodesRow({ total, hits }, guildId) {
  if (!total) return `📍 **Nodes**   ${NO}${channelSuffix(guildId, firstChannel('NODES_CHANNELS'))}`;
  const posted = hits.length;
  const icon = posted === 0 ? NO : posted === total ? OK : PARTIAL;
  // Prefer jumping to the first posted embed; otherwise link to the first
  // configured Nodes channel so the admin can still navigate there.
  const suffix = hits.length
    ? jumpSuffix(guildId, hits[0].channelId, hits[0].messageId)
    : channelSuffix(guildId, firstChannel('NODES_CHANNELS'));
  return `📍 **Nodes**   ${icon}${suffix}   _(${posted}/${total} channel${total === 1 ? '' : 's'})_`;
}

// ── Menus ────────────────────────────────────────────────────────────────────

function factionMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_faction_select')
      .setPlaceholder('🛡️  Faction Embed — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('reload')
          .setLabel('Reload Faction Embed')
          .setDescription('Delete the current embed and post a fresh one.')
          .setEmoji('🔄'),
        new StringSelectMenuOptionBuilder()
          .setValue('reset')
          .setLabel('Reset Roles')
          .setDescription('Remove Allies / Axis roles from every member.')
          .setEmoji('♻️')
      )
  );
}

function lineupMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_lineup_select')
      .setPlaceholder('📋  Lineup — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S1')
          .setLabel('Edit Lineup — S1')
          .setDescription('Edit the Server 1 lineup caption.')
          .setEmoji('✏️'),
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S2')
          .setLabel('Edit Lineup — S2')
          .setDescription('Edit the Server 2 lineup caption.')
          .setEmoji('✏️')
      )
  );
}

function serverMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_server_select')
      .setPlaceholder('🖥️  Server Details — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('post:S1')
          .setLabel('Post Server Details — S1')
          .setDescription('Publish the Server 1 details embed.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('post:S2')
          .setLabel('Post Server Details — S2')
          .setDescription('Publish the Server 2 details embed.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S1')
          .setLabel('Edit Server Details — S1')
          .setDescription('Edit the Server 1 details embed.')
          .setEmoji('✏️'),
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S2')
          .setLabel('Edit Server Details — S2')
          .setDescription('Edit the Server 2 details embed.')
          .setEmoji('✏️')
      )
  );
}

function rotNodesMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_rotnodes_select')
      .setPlaceholder('🗺️ 📍  Map Rotation & Nodes — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:sync')
          .setLabel('Sync Map Rotation')
          .setDescription('Repair month alignment, cache, message, and duplicates.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:edit')
          .setLabel('Edit Map Rotation')
          .setDescription('Edit the current rotation events.')
          .setEmoji('✏️'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:advance')
          .setLabel('Advance Rotation (+1 month)')
          .setDescription('Preview and confirm moving the window forward.')
          .setEmoji('⏩'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:reset')
          .setLabel('Reset to Current Month')
          .setDescription('Rebuild the current two-month window; supports Undo.')
          .setEmoji('♻️'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:undo')
          .setLabel('Undo Rotation Change')
          .setDescription('Restore the most recent saved rotation state.')
          .setEmoji('↩️'),
        new StringSelectMenuOptionBuilder()
          .setValue('nodes:post')
          .setLabel('Post Nodes')
          .setDescription('Publish the NODES embed to every configured channel.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('nodes:edit')
          .setLabel('Edit Nodes')
          .setDescription('Edit the current NODES embed fields.')
          .setEmoji('✏️')
      )
  );
}

function panelMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_panel_select')
      .setPlaceholder('🛠️  Panel — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('refresh')
          .setLabel('Refresh Status')
          .setDescription('Re-check posted state of every embed.')
          .setEmoji('🔄'),
        new StringSelectMenuOptionBuilder()
          .setValue('postall')
          .setLabel('Post All Missing')
          .setDescription('Publish default embeds for every 🔴 section (Server, Rotation, Nodes).')
          .setEmoji('📮'),
        new StringSelectMenuOptionBuilder()
          .setValue('midcap')
          .setLabel('Post Mid Cap Poll')
          .setDescription("Post the Discord poll for the next match's mid cap.")
          .setEmoji('📊'),
        new StringSelectMenuOptionBuilder()
          .setValue('signups')
          .setLabel('Signups — manage')
          .setDescription('Per-clan RaidHelper signups: post, cancel, auto-post.')
          .setEmoji('📅'),
        new StringSelectMenuOptionBuilder()
          .setValue('healthcheck')
          .setLabel('Healthcheck')
          .setDescription('Verify env, channel perms, roles, and cached message IDs.')
          .setEmoji('🩺'),
        new StringSelectMenuOptionBuilder()
          .setValue('clearlogs')
          .setLabel('Clear Log Channel')
          .setDescription('Delete every message in the admin log channel.')
          .setEmoji('🧹')
      )
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

function buildFooter() {
  const base = `v${pkg.version}  •  deployed ${humanizeAgo(Date.now() - BOT_STARTED_AT_MS)}`;
  const last = loadLastAction();
  if (!last) return base;
  const who = last.userTag || `@${last.userId}`;
  return `${base}  •  last: ${last.action} by ${who} ${humanizeAgo(Date.now() - last.ts)}`;
}

// ── Payload builder ──────────────────────────────────────────────────────────

async function buildPanelPayload(client, guildId) {
  const state = await probePanelState(client);
  const { faction: fac, lineupS1: l1, lineupS2: l2, serverS1: s1, serverS2: s2, rotation: rot, nodes, midcap } = state;

  const missingEnv = listMissingEnv();
  const nextReset  = getNextResetTime();

  const rows = [
    factionRow(fac, guildId),
    serverPairRow('📋 **Lineup**', l1, l2, guildId, 'LINEUP_CHANNEL'),
    serverPairRow('🖥️ **Server Details**', s1, s2, guildId, 'SERVER_DETAILS_CHANNEL'),
    rotationRow(rot, guildId),
    nodesRow(nodes, guildId),
    midCapRow(midcap, guildId),
    signupsPanelRow()
  ].filter(Boolean);
  if (nextReset) {
    rows.push(`⏰ **Auto-Reset**   <t:${nextReset}:R>`);
  }
  if (missingEnv.length) {
    rows.push(`⚠️ **Env**   ${missingEnv.length} missing: \`${missingEnv.slice(0, 6).join('`, `')}\`${missingEnv.length > 6 ? '…' : ''}`);
  }
  rows.push('', `_${OK} posted  •  ${PARTIAL} partial  •  ${NO} not posted  •  ↗ jump to message_`);
  const description = rows.join('\n');

  const embed = new EmbedBuilder()
    .setTitle('⚙️  Admin Panel')
    .setColor(COLORS.primary)
    .setDescription(description)
    .setFooter({ text: buildFooter() });

  return {
    embeds: [embed],
    components: [factionMenu(), lineupMenu(), serverMenu(), rotNodesMenu(), panelMenu()]
  };
}

// ── Auto-refresh helper ──────────────────────────────────────────────────────
// Edits the panel message in place after an admin action. Called from the
// interaction router after each state-changing handler. Failures are
// swallowed — we never want a panel-refresh error to leak into the user's
// action confirmation.

async function refreshPanelMessage(interaction) {
  try {
    const msg = interaction.message;
    if (!msg) return;
    const payload = await buildPanelPayload(interaction.client, interaction.guildId);
    await msg.edit(payload);
  } catch (_) { /* best effort */ }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the admin control panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = await buildPanelPayload(interaction.client, interaction.guildId);
    await interaction.editReply(payload);
  },

  refreshPanelMessage,
  probePanelState
};
