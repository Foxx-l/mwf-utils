// @ts-check
/**
 * controls.js — The panel's interactive controls, as data.
 *
 * Every customId lives here, so the renderers and the router's route tables
 * cannot drift apart, and adding an action is a one-line data change instead of
 * another twenty-line builder.
 *
 * Options are gated on the same `isConfigured()` the status rows use: a feature
 * that isn't set up offers no actions, rather than offering one that dies in the
 * handler. When every option of a menu is gated away the whole row goes — a
 * select with no options is an invalid payload, and it also frees a row for
 * minimal deployments.
 *
 * The three diagnostics (Refresh, Healthcheck, Post All Missing) are never
 * gated: a broken `.env` is exactly when an admin needs them.
 */

const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { hasEnv } = require('../config/env');
const { isConfigured } = require('./features');

// Discord's own limits, asserted here rather than discovered at send time.
const MAX_ROWS = 5;
const MAX_OPTIONS = 25;

/**
 * @typedef {Object} PanelOption
 * @property {string} value
 * @property {string} label
 * @property {string} description
 * @property {string} emoji
 * @property {string|null} [feature]  overrides the menu's feature; null = never gated
 * @property {import('../config/env').EnvRequirement} [requires]  extra env gate
 *
 * @typedef {Object} PanelMenu
 * @property {string} id
 * @property {string} placeholder  the "— choose action" suffix is added here
 * @property {string} [feature]    default gate for every option
 * @property {PanelOption[]} options
 */

/** @type {PanelMenu[]} */
const MENUS = [
  {
    id: 'admin_faction_select',
    placeholder: '🛡️  Faction Embed',
    feature: 'faction',
    options: [
      { value: 'reload', label: 'Reload Faction Embed', description: 'Delete the current embed and post a fresh one.', emoji: '🔄' },
      // Roles, not the embed: worth offering even without FACTION_CHANNEL, and
      // the bot refuses to boot without the role vars anyway.
      { value: 'reset', label: 'Reset Roles', description: 'Remove Allies / Axis roles from every member.', emoji: '♻️', feature: null },
    ],
  },
  {
    id: 'admin_lineup_select',
    placeholder: '📋  Lineup',
    feature: 'lineup',
    options: [
      { value: 'edit:S1', label: 'Edit Lineup — S1', description: 'Edit the Server 1 lineup caption.', emoji: '✏️' },
      { value: 'edit:S2', label: 'Edit Lineup — S2', description: 'Edit the Server 2 lineup caption.', emoji: '✏️' },
    ],
  },
  {
    id: 'admin_server_select',
    placeholder: '🖥️  Server Details',
    feature: 'server',
    options: [
      { value: 'post:S1', label: 'Post Server Details — S1', description: 'Publish the Server 1 details embed.', emoji: '📤' },
      { value: 'post:S2', label: 'Post Server Details — S2', description: 'Publish the Server 2 details embed.', emoji: '📤' },
      { value: 'edit:S1', label: 'Edit Server Details — S1', description: 'Edit the Server 1 details embed.', emoji: '✏️' },
      { value: 'edit:S2', label: 'Edit Server Details — S2', description: 'Edit the Server 2 details embed.', emoji: '✏️' },
    ],
  },
  {
    id: 'admin_rotnodes_select',
    placeholder: '🗺️ 📍  Map Rotation & Nodes',
    options: [
      { value: 'rotation:sync',    label: 'Sync Map Rotation',            description: 'Repair month alignment, cache, message, and duplicates.', emoji: '📤', feature: 'rotation' },
      { value: 'rotation:edit',    label: 'Edit Map Rotation',            description: 'Edit the current rotation events.',                       emoji: '✏️', feature: 'rotation' },
      { value: 'rotation:advance', label: 'Advance Rotation (+1 month)',  description: 'Preview and confirm moving the window forward.',          emoji: '⏩', feature: 'rotation' },
      { value: 'rotation:reset',   label: 'Reset to Current Month',       description: 'Rebuild the current two-month window; supports Undo.',    emoji: '♻️', feature: 'rotation' },
      { value: 'rotation:undo',    label: 'Undo Rotation Change',         description: 'Restore the most recent saved rotation state.',           emoji: '↩️', feature: 'rotation' },
      { value: 'nodes:post',       label: 'Post Nodes',                   description: 'Publish the NODES embed to every configured channel.',    emoji: '📤', feature: 'nodes' },
      { value: 'nodes:edit',       label: 'Edit Nodes',                   description: 'Edit the current NODES embed fields.',                    emoji: '✏️', feature: 'nodes' },
    ],
  },
  {
    id: 'admin_panel_select',
    placeholder: '🛠️  Panel',
    options: [
      { value: 'refresh',     label: 'Refresh Status',    description: 'Re-check posted state of every embed.',                                  emoji: '🔄', feature: null },
      { value: 'postall',     label: 'Post All Missing',  description: 'Publish default embeds for every 🔴 section (Server, Rotation, Nodes).', emoji: '📮', feature: null },
      { value: 'midcap',      label: 'Post Mid Cap Poll', description: "Post the Discord poll for the next match's mid cap.",                    emoji: '📊', feature: 'midcap' },
      { value: 'signups',     label: 'Signups — manage',  description: 'Per-clan RaidHelper signups: post, cancel, auto-post.',                  emoji: '📅', feature: 'signups' },
      { value: 'healthcheck', label: 'Healthcheck',       description: 'Verify env, channel perms, roles, and cached message IDs.',              emoji: '🩺', feature: null },
      { value: 'clearlogs',   label: 'Clear Log Channel', description: 'Delete every message in the admin log channel.',                         emoji: '🧹', feature: null, requires: 'ADMIN_LOG_CHANNEL' },
    ],
  },
];

/**
 * @param {PanelMenu} menu
 * @param {PanelOption} option
 */
function optionEnabled(menu, option) {
  const feature = option.feature === undefined ? menu.feature : option.feature;
  if (feature && !isConfigured(feature)) return false;
  if (option.requires && !hasEnv(option.requires)) return false;
  return true;
}

/** The options of one menu that this environment can actually use. */
function enabledOptions(menu) {
  return menu.options.filter(option => optionEnabled(menu, option));
}

/** @param {PanelMenu} menu @param {PanelOption[]} options */
function buildMenuRow(menu, options) {
  if (options.length > MAX_OPTIONS) {
    throw new Error(`Panel menu ${menu.id} has ${options.length} options; Discord allows ${MAX_OPTIONS}.`);
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(menu.id)
      .setPlaceholder(`${menu.placeholder} — choose action`)
      .addOptions(options.map(option => new StringSelectMenuOptionBuilder()
        .setValue(option.value)
        .setLabel(option.label)
        .setDescription(option.description)
        .setEmoji(option.emoji)))
  );
}

/** The panel's select rows, in display order, minus anything unusable. */
function buildPanelComponents() {
  const rows = MENUS
    .map(menu => ({ menu, options: enabledOptions(menu) }))
    .filter(({ options }) => options.length > 0)
    .map(({ menu, options }) => buildMenuRow(menu, options));

  if (rows.length > MAX_ROWS) {
    throw new Error(`Panel needs ${rows.length} component rows; Discord allows ${MAX_ROWS}.`);
  }
  return rows;
}

/**
 * The customIds that sit *on the panel message*. A component interaction with
 * one of these can redraw the panel through its own token; anything else (a
 * confirm dialog, an edit preview) lives on a different message and cannot.
 */
const PANEL_CONTROL_IDS = new Set(MENUS.map(menu => menu.id));

module.exports = {
  MENUS,
  MAX_ROWS,
  MAX_OPTIONS,
  optionEnabled,
  enabledOptions,
  buildPanelComponents,
  PANEL_CONTROL_IDS,
};
