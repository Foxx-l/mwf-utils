// @ts-check
/**
 * payload.js — Assembles the `/panel` message: probe, render rows, attach
 * controls. The one place that knows what a panel message looks like, so the
 * command, the refresh and "post all missing" all show the same thing.
 */

const { EmbedBuilder } = require('discord.js');

const { COLORS } = require('../config/theme');
const { loadLastAction } = require('../utils/lastActionStore');
const { getNextResetTime } = require('../utils/scheduler');
const { probePanelState } = require('./probes');
const { buildPanelComponents } = require('./controls');
const {
  OK,
  NO,
  PARTIAL,
  factionRow,
  serverPairRow,
  rotationRow,
  midCapRow,
  nodesRow,
  signupsPanelRow,
} = require('./rows');
const pkg = require('../../package.json');

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

const BOT_STARTED_AT_MS = Date.now();

function humanizeAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function buildFooter() {
  const base = `v${pkg.version}  •  deployed ${humanizeAgo(Date.now() - BOT_STARTED_AT_MS)}`;
  const last = loadLastAction();
  if (!last) return base;
  const who = last.userTag || `@${last.userId}`;
  return `${base}  •  last: ${last.action} by ${who} ${humanizeAgo(Date.now() - last.ts)}`;
}

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

  // Cast at the boundary: an ActionRowBuilder built without a type argument is
  // ActionRowBuilder<AnyComponentBuilder>, which is wider than the row types
  // discord.js accepts in its own reply options. The rows really are select
  // rows, so this is the single place that says so.
  return /** @type {import('discord.js').InteractionEditReplyOptions} */ ({
    embeds: [embed],
    components: buildPanelComponents()
  });
}

module.exports = {
  REQUIRED_ENV_VARS,
  listMissingEnv,
  humanizeAgo,
  buildFooter,
  buildPanelPayload,
};
