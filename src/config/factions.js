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

const FACTIONS = Object.freeze({
  allies_s1: {
    key:     'allies_s1',
    envVar:  'ALLIES_ROLE',
    label:   'Allies - S1',
    emoji:   'ALLIES',
    fallbackEmoji: '🔵',
    color:   0x3b82f6,
    style:   ButtonStyle.Primary
  },
  axis_s1: {
    key:     'axis_s1',
    envVar:  'AXIS_ROLE',
    label:   'Axis - S1',
    emoji:   'AXIS',
    fallbackEmoji: '🔴',
    color:   0xef4444,
    style:   ButtonStyle.Danger
  },
  allies_s2: {
    key:     'allies_s2',
    envVar:  'ALLIES_S2_ROLE',
    label:   'Allies - S2',
    emoji:   'ALLIES',
    fallbackEmoji: '🔵',
    color:   0x3b82f6,
    style:   ButtonStyle.Primary
  },
  axis_s2: {
    key:     'axis_s2',
    envVar:  'AXIS_S2_ROLE',
    label:   'Axis - S2',
    emoji:   'AXIS',
    fallbackEmoji: '🔴',
    color:   0xef4444,
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

module.exports = { FACTIONS, getFaction, getFactionRoleId, getAllFactionRoleIds };
