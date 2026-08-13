// @ts-check
/**
 * rows.js — One status line per feature, plus the jump links they carry.
 *
 * Pure text: every builder takes probe results and returns a string (or `null`
 * to leave the feature out), so the renderers stay free of Discord calls and
 * the lines are assertable in tests.
 */

const { GLYPHS, statusGlyph } = require('../config/theme');
const { monthHeader } = require('../utils/rotationState');
const { signupsPanelRow } = require('../handlers/interactions/signupHandler');

const OK = GLYPHS.ok;
const NO = GLYPHS.missing;
const PARTIAL = GLYPHS.partial;

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

function firstChannel(envKey) {
  const raw = process.env[envKey];
  if (!raw) return null;
  return String(raw).split(',').map(s => s.trim()).find(Boolean) ?? null;
}

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
  const icon = statusGlyph(posted, total);
  // Prefer jumping to the first posted embed; otherwise link to the first
  // configured Nodes channel so the admin can still navigate there.
  const suffix = hits.length
    ? jumpSuffix(guildId, hits[0].channelId, hits[0].messageId)
    : channelSuffix(guildId, firstChannel('NODES_CHANNELS'));
  return `📍 **Nodes**   ${icon}${suffix}   _(${posted}/${total} channel${total === 1 ? '' : 's'})_`;
}

module.exports = {
  OK,
  NO,
  PARTIAL,
  jumpUrl,
  channelUrl,
  jumpSuffix,
  channelSuffix,
  firstChannel,
  bestSuffix,
  factionRow,
  serverPairRow,
  rotationRow,
  midCapRow,
  nodesRow,
  signupsPanelRow,
};
