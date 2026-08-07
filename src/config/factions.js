// @ts-check
/**
 * factions.js — Central definition of all selectable factions.
 *
 * A faction is uniquely identified by a key (e.g. `allies_s1`). Each entry maps
 * to an env var containing the Discord role ID, plus UI metadata (label,
 * emoji, button style, color) used when rendering buttons and log embeds.
 *
 * Adding a new faction is a single-file change — append an entry here and all
 * downstream consumers (buttons, handler, scheduler, admin reset) pick it up.
 */

const { ButtonStyle } = require('discord.js');
const { COLORS } = require('./theme');

const FACTIONS = Object.freeze({
  allies_s1: {
    key:     'allies_s1',
    envVar:  'ALLIES_ROLE',
    team:    'allies',
    label:   'Allies - S1',
    emoji:   'ALLIES',
    fallbackEmoji: '🔵',
    color:   COLORS.allies,
    style:   ButtonStyle.Primary
  },
  axis_s1: {
    key:     'axis_s1',
    envVar:  'AXIS_ROLE',
    team:    'axis',
    label:   'Axis - S1',
    emoji:   'AXIS',
    fallbackEmoji: '🔴',
    color:   COLORS.axis,
    style:   ButtonStyle.Danger
  },
  allies_s2: {
    key:     'allies_s2',
    envVar:  'ALLIES_S2_ROLE',
    team:    'allies',
    label:   'Allies - S2',
    emoji:   'ALLIES',
    fallbackEmoji: '🔵',
    color:   COLORS.allies,
    style:   ButtonStyle.Primary
  },
  axis_s2: {
    key:     'axis_s2',
    envVar:  'AXIS_S2_ROLE',
    team:    'axis',
    label:   'Axis - S2',
    emoji:   'AXIS',
    fallbackEmoji: '🔴',
    color:   COLORS.axis,
    style:   ButtonStyle.Danger
  }
});

function getFaction(key) {
  return FACTIONS[key] ?? null;
}

function getFactionRoleId(key) {
  const f = FACTIONS[key];
  return f ? process.env[f.envVar] : undefined;
}

/**
 * Returns every configured role ID across all factions (missing env vars are
 * filtered out). Order matches FACTIONS declaration order.
 */
function getAllFactionRoleIds() {
  return Object.values(FACTIONS)
    .map(f => process.env[f.envVar])
    .filter(Boolean);
}

/**
 * Which side a member plays on, derived from the faction role they hold.
 * S1 and S2 collapse to the same team — a member on Allies S2 votes with the
 * Allies. Returns `'allies'`, `'axis'`, or null when they hold no faction role
 * (or somehow hold both, which we refuse to guess at).
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {'allies'|'axis'|null}
 */
function getMemberTeam(member) {
  const held = new Set();
  for (const faction of Object.values(FACTIONS)) {
    const roleId = process.env[faction.envVar];
    if (roleId && member?.roles?.cache?.has(roleId)) held.add(faction.team);
  }
  return held.size === 1 ? /** @type {'allies'|'axis'} */ ([...held][0]) : null;
}

/** Display metadata for a team key, used by the Mid Cap embed. */
const TEAMS = Object.freeze({
  allies: { key: 'allies', label: 'Allies', emoji: '🔵', color: COLORS.allies },
  axis:   { key: 'axis',   label: 'Axis',   emoji: '🔴', color: COLORS.axis },
});

module.exports = { FACTIONS, TEAMS, getFaction, getFactionRoleId, getAllFactionRoleIds, getMemberTeam };
