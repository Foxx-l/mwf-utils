// @ts-check
/**
 * rows.js — One status line per feature, and the summary/legend/meta lines
 * around them.
 *
 * Pure text, shared by both renderers: the classic embed joins the lines into a
 * description, the container turns each one into its own section. A builder
 * returns `null` when the feature isn't configured — an unconfigured feature is
 * listed once under "Not configured" instead of showing a 🔴 that no action can
 * clear, so a red dot always means "set up, but not posted", which is exactly
 * what Post All Missing acts on.
 *
 * Each row also reports the states it shows (a pair row shows two), which is
 * what the summary line counts.
 */

const { GLYPHS, statusGlyph } = require('../config/theme');
const { firstCsvValue } = require('../config/env');
const { monthHeader } = require('../utils/rotationState');
const { isConfigured } = require('./features');
const { signupsPanelRow } = require('../handlers/interactions/signupHandler');

const OK = GLYPHS.ok;
const NO = GLYPHS.missing;
const PARTIAL = GLYPHS.partial;

/** @typedef {'ok'|'partial'|'missing'} RowState */
/** @typedef {{ text: string, states: RowState[] }} StatusRow */

/**
 * @param {string} text
 * @param {...RowState} states
 * @returns {StatusRow}
 */
function row(text, ...states) {
  return { text, states };
}

/** @param {boolean} posted */
function state(posted) {
  return posted ? 'ok' : 'missing';
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
  return url ? `  [${GLYPHS.jump}](${url})` : '';
}

// Fallback suffix used when there is no posted message yet — link to the
// destination channel so the admin can jump to where the embed *would*
// appear once posted. Returns '' when channelId is unknown.
function channelSuffix(guildId, channelId) {
  const url = channelUrl(guildId, channelId);
  return url ? `  [${GLYPHS.jump}](${url})` : '';
}

// Prefer a direct message jump when available; otherwise fall back to the
// destination channel so admins always get a clickable target.
function bestSuffix(guildId, locator, fallbackChannelId) {
  if (locator) return jumpSuffix(guildId, locator.channelId, locator.messageId);
  return channelSuffix(guildId, fallbackChannelId);
}

function factionRow(locator, guildId) {
  if (!isConfigured('faction')) return null;
  const ch = process.env.FACTION_CHANNEL;
  return row(
    `🛡️ **Faction Embed**   ${locator ? OK : NO}${bestSuffix(guildId, locator, ch)}`,
    state(Boolean(locator))
  );
}

/**
 * Lineup and Server Details are S1/S2 pairs, so one row carries two states.
 * @param {string} feature 'lineup' | 'server'
 */
function serverPairRow(feature, emojiLabel, l1, l2, guildId, envKey) {
  if (!isConfigured(feature)) return null;
  const ch = process.env[envKey];
  const s1 = `${l1 ? OK : NO}${bestSuffix(guildId, l1, ch)}`;
  const s2 = `${l2 ? OK : NO}${bestSuffix(guildId, l2, ch)}`;
  return row(`${emojiLabel}   S1 ${s1} • S2 ${s2}`, state(Boolean(l1)), state(Boolean(l2)));
}

function rotationRow(locator, guildId) {
  if (!isConfigured('rotation')) return null;
  const ch = process.env.MAP_ROTATION_CHANNEL;
  if (!locator) return row(`🗺️ **Map Rotation**   ${NO}${channelSuffix(guildId, ch)}`, 'missing');
  const months = locator.state?.months;
  const window = months?.length === 2
    ? `${monthHeader(months[0].year, months[0].month)} / ${monthHeader(months[1].year, months[1].month)}`
    : 'state recovering';
  const history = locator.historyCount ? ` • ${locator.historyCount} undo` : '';
  return row(`🗺️ **Map Rotation**   ${OK}${bestSuffix(guildId, locator, ch)}   _${window}${history}_`, 'ok');
}

function midCapRow(probe, guildId) {
  if (!isConfigured('midcap') || !probe) return null;
  const ch = process.env.MIDCAP_CHANNEL;
  if (!probe.match) {
    return row(`📊 **Mid Cap Poll**   ${NO}${channelSuffix(guildId, ch)}   _no scheduled match_`, 'missing');
  }
  const posted = Boolean(probe.locator);
  const note = probe.match.live ? 'live · voting closed' : probe.match.map;
  return row(
    `📊 **Mid Cap Poll**   ${posted ? OK : NO}${bestSuffix(guildId, probe.locator, ch)}   _${note}_`,
    state(posted)
  );
}

function nodesRow({ total, hits }, guildId) {
  if (!isConfigured('nodes') || !total) return null;
  const posted = hits.length;
  // Prefer jumping to the first posted embed; otherwise link to the first
  // configured Nodes channel so the admin can still navigate there.
  const suffix = hits.length
    ? jumpSuffix(guildId, hits[0].channelId, hits[0].messageId)
    : channelSuffix(guildId, firstCsvValue('NODES_CHANNELS'));
  return row(
    `📍 **Nodes**   ${statusGlyph(posted, total)}${suffix}   _(${posted}/${total} channel${total === 1 ? '' : 's'})_`,
    posted === 0 ? 'missing' : posted === total ? 'ok' : 'partial'
  );
}

/** The signups line, which the signups feature owns (it counts its own events). */
function signupsRow() {
  const text = signupsPanelRow();
  if (!text) return null;
  const glyph = text.includes(OK) ? 'ok' : text.includes(PARTIAL) ? 'partial' : 'missing';
  return row(text, /** @type {RowState} */ (glyph));
}

/**
 * Every status row, in display order, with the feature key and group so a
 * renderer can lay them out (and attach the right accessory button).
 * @returns {Array<{ key: string, group: string, text: string, states: RowState[] }>}
 */
function statusRows(probeState, guildId) {
  const { faction, lineupS1, lineupS2, serverS1, serverS2, rotation, nodes, midcap } = probeState;
  /** @type {Array<[string, string, StatusRow|null]>} */
  const entries = [
    ['faction',  'embeds',   factionRow(faction, guildId)],
    ['lineup',   'embeds',   serverPairRow('lineup', '📋 **Lineup**', lineupS1, lineupS2, guildId, 'LINEUP_CHANNEL')],
    ['server',   'embeds',   serverPairRow('server', '🖥️ **Server Details**', serverS1, serverS2, guildId, 'SERVER_DETAILS_CHANNEL')],
    ['rotation', 'embeds',   rotationRow(rotation, guildId)],
    ['nodes',    'embeds',   nodesRow(nodes, guildId)],
    ['midcap',   'matchday', midCapRow(midcap, guildId)],
    ['signups',  'matchday', signupsRow()],
  ];
  return entries
    .filter(([, , value]) => Boolean(value))
    .map(([key, group, value]) => ({ key, group, text: value.text, states: value.states }));
}

/**
 * The one-line answer to "do I need to do anything?", which also replaces the
 * legend for anyone who reads it.
 * @param {Array<{states: RowState[]}>} rows
 */
function summaryLine(rows) {
  const states = rows.flatMap(r => r.states);
  const count = wanted => states.filter(s => s === wanted).length;
  const parts = [`${OK} ${count('ok')} posted`];
  if (count('partial')) parts.push(`${PARTIAL} ${count('partial')} partial`);
  parts.push(`${NO} ${count('missing')} missing`);
  parts.push(`as of <t:${Math.floor(Date.now() / 1000)}:t>`);
  return parts.join(' · ');
}

/**
 * The lines below the statuses: next reset, what isn't configured, missing env.
 * @param {{ nextReset: number|null, idle: readonly {label: string}[], missingEnv: string[] }} opts
 */
function metaLines({ nextReset, idle, missingEnv }) {
  const lines = [];
  if (nextReset) lines.push(`⏰ **Auto-Reset**   <t:${nextReset}:R>`);
  if (idle.length) lines.push(`💤 **Not configured**   ${idle.map(f => f.label).join(', ')}`);
  if (missingEnv.length) {
    lines.push(`${GLYPHS.warn} **Env**   ${missingEnv.length} missing: \`${missingEnv.slice(0, 6).join('`, `')}\`${missingEnv.length > 6 ? '…' : ''}`);
  }
  return lines;
}

function legendLine() {
  return `${OK} posted  •  ${PARTIAL} partial  •  ${NO} not posted  •  ${GLYPHS.jump} jump to message`;
}

module.exports = {
  OK,
  NO,
  PARTIAL,
  jumpUrl,
  channelUrl,
  jumpSuffix,
  channelSuffix,
  bestSuffix,
  factionRow,
  serverPairRow,
  rotationRow,
  midCapRow,
  nodesRow,
  signupsRow,
  statusRows,
  summaryLine,
  metaLines,
  legendLine,
};
