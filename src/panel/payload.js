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
const { idleFeatures, listMissingEnv } = require('./features');
const {
  OK,
  NO,
  PARTIAL,
  factionRow,
  serverPairRow,
  rotationRow,
  midCapRow,
  nodesRow,
  idleRow,
  signupsPanelRow,
} = require('./rows');
const pkg = require('../../package.json');

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
    serverPairRow('lineup', '📋 **Lineup**', l1, l2, guildId, 'LINEUP_CHANNEL'),
    serverPairRow('server', '🖥️ **Server Details**', s1, s2, guildId, 'SERVER_DETAILS_CHANNEL'),
    rotationRow(rot, guildId),
    nodesRow(nodes, guildId),
    midCapRow(midcap, guildId),
    signupsPanelRow()
  ].filter(Boolean);
  if (nextReset) {
    rows.push(`⏰ **Auto-Reset**   <t:${nextReset}:R>`);
  }
  const idle = idleRow(idleFeatures());
  if (idle) rows.push(idle);
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
  humanizeAgo,
  buildFooter,
  buildPanelPayload,
};
