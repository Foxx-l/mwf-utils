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
 * select with no options is an invalid payload.
 *
 * The three diagnostics (Refresh, Healthcheck, Post All Missing) are never
 * gated: a broken `.env` is exactly when an admin needs them.
 *
 * There are two menu layouts, because the two renderers have different room.
 * The container promotes each feature's obvious action to a button on its own
 * row, so its dropdowns hold only what is left; the embed has no buttons at all,
 * so it keeps every action in the five menus it has always had. Both are built
 * from the same option definitions, and the old customIds stay routed either
 * way, so a panel opened before a deploy keeps working.
 */

const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasEnv } = require('../config/env');
const { isConfigured } = require('./features');

// Discord's own limits, asserted here rather than discovered at send time. Five
// rows is the documented cap for a message's components; whether a Components V2
// container lifts it is undocumented, so the container layout stays within it.
const MAX_ROWS = 5;
const MAX_OPTIONS = 25;

/**
 * @typedef {Object} PanelOption
 * @property {string} value
 * @property {string} label
 * @property {string} description
 * @property {string} emoji
 * @property {string|null} [feature]  gate; null = never gated
 * @property {import('../config/env').EnvRequirement} [requires]  extra env gate
 *
 * @typedef {Object} PanelMenu
 * @property {string} id
 * @property {string} placeholder  the "— choose action" suffix is added here
 * @property {PanelOption[]} options
 */

// ── Action definitions ───────────────────────────────────────────────────────
// The `value` each one carries is per-menu (the container's menus namespace
// theirs), so it is supplied where the menu is composed.

/** @type {Record<string, Omit<PanelOption, 'value'>>} */
const ACTIONS = {
  factionReload: { label: 'Reload Faction Embed', description: 'Delete the current embed and post a fresh one.', emoji: '🔄', feature: 'faction' },
  // Roles, not the embed: worth offering even without FACTION_CHANNEL, and the
  // bot refuses to boot without the role vars anyway.
  factionReset:  { label: 'Reset Roles', description: 'Remove Allies / Axis roles from every member.', emoji: '♻️', feature: null },

  lineupEditS1: { label: 'Edit Lineup — S1', description: 'Edit the Server 1 lineup caption.', emoji: '✏️', feature: 'lineup' },
  lineupEditS2: { label: 'Edit Lineup — S2', description: 'Edit the Server 2 lineup caption.', emoji: '✏️', feature: 'lineup' },

  serverPostS1: { label: 'Post Server Details — S1', description: 'Publish the Server 1 details embed.', emoji: '📤', feature: 'server' },
  serverPostS2: { label: 'Post Server Details — S2', description: 'Publish the Server 2 details embed.', emoji: '📤', feature: 'server' },
  serverEditS1: { label: 'Edit Server Details — S1', description: 'Edit the Server 1 details embed.', emoji: '✏️', feature: 'server' },
  serverEditS2: { label: 'Edit Server Details — S2', description: 'Edit the Server 2 details embed.', emoji: '✏️', feature: 'server' },

  rotationSync:    { label: 'Sync Map Rotation',           description: 'Repair month alignment, cache, message, and duplicates.', emoji: '📤', feature: 'rotation' },
  rotationEdit:    { label: 'Edit Map Rotation',           description: 'Edit the current rotation events.',                       emoji: '✏️', feature: 'rotation' },
  rotationAdvance: { label: 'Advance Rotation (+1 month)', description: 'Preview and confirm moving the window forward.',          emoji: '⏩', feature: 'rotation' },
  rotationReset:   { label: 'Reset to Current Month',      description: 'Rebuild the current two-month window; supports Undo.',    emoji: '♻️', feature: 'rotation' },
  rotationUndo:    { label: 'Undo Rotation Change',        description: 'Restore the most recent saved rotation state.',           emoji: '↩️', feature: 'rotation' },

  nodesPost: { label: 'Post Nodes', description: 'Publish the NODES embed to every configured channel.', emoji: '📤', feature: 'nodes' },
  nodesEdit: { label: 'Edit Nodes', description: 'Edit the current NODES embed fields.',                 emoji: '✏️', feature: 'nodes' },

  midcapPost: { label: 'Post Mid Cap Poll', description: "Post the Discord poll for the next match's mid cap.", emoji: '📊', feature: 'midcap' },

  signupsPost:   { label: 'Post signups now',            description: 'Create the RaidHelper events for the next match.',        emoji: '📮', feature: 'signups' },
  signupsSync:   { label: 'Sync signup channels',        description: 'Create missing category/channels for the current tags.',  emoji: '🔧', feature: 'signups' },
  signupsToggle: { label: 'Toggle signup auto-post',     description: 'Posts the next match by itself, right after each match.', emoji: '▶️', feature: 'signups' },
  signupsCancel: { label: 'Cancel next match signups',   description: 'Delete the posted events for the next match.',            emoji: '🗑️', feature: 'signups' },

  refresh:     { label: 'Refresh Status',   description: 'Re-check posted state of every embed.',                                  emoji: '🔄', feature: null },
  postall:     { label: 'Post All Missing', description: 'Publish default embeds for every 🔴 section (Server, Rotation, Nodes).', emoji: '📮', feature: null },
  healthcheck: { label: 'Healthcheck',      description: 'Verify env, channel perms, roles, and cached message IDs.',              emoji: '🩺', feature: null },
  clearlogs:   { label: 'Clear Log Channel', description: 'Delete every message in the admin log channel.', emoji: '🧹', feature: null, requires: 'ADMIN_LOG_CHANNEL' },
};

/** @param {keyof typeof ACTIONS} key @param {string} value */
function option(key, value) {
  return { ...ACTIONS[key], value };
}

// ── The embed layout's menus (five rows, every action) ───────────────────────

/** @type {PanelMenu[]} */
const MENUS_V1 = [
  {
    id: 'admin_faction_select',
    placeholder: '🛡️  Faction Embed',
    options: [option('factionReload', 'reload'), option('factionReset', 'reset')],
  },
  {
    id: 'admin_lineup_select',
    placeholder: '📋  Lineup',
    options: [option('lineupEditS1', 'edit:S1'), option('lineupEditS2', 'edit:S2')],
  },
  {
    id: 'admin_server_select',
    placeholder: '🖥️  Server Details',
    options: [
      option('serverPostS1', 'post:S1'), option('serverPostS2', 'post:S2'),
      option('serverEditS1', 'edit:S1'), option('serverEditS2', 'edit:S2'),
    ],
  },
  {
    id: 'admin_rotnodes_select',
    placeholder: '🗺️ 📍  Map Rotation & Nodes',
    options: [
      option('rotationSync', 'rotation:sync'),
      option('rotationEdit', 'rotation:edit'),
      option('rotationAdvance', 'rotation:advance'),
      option('rotationReset', 'rotation:reset'),
      option('rotationUndo', 'rotation:undo'),
      option('nodesPost', 'nodes:post'),
      option('nodesEdit', 'nodes:edit'),
    ],
  },
  {
    id: 'admin_panel_select',
    placeholder: '🛠️  Panel',
    options: [
      option('refresh', 'refresh'),
      option('postall', 'postall'),
      option('midcapPost', 'midcap'),
      option('healthcheck', 'healthcheck'),
      option('clearlogs', 'clearlogs'),
    ],
  },
];

// ── The container layout's menus (four rows; the rest are buttons) ───────────

/** @type {PanelMenu[]} */
const MENUS_V2 = [
  {
    id: 'admin_content_select',
    placeholder: '📋 🖥️ 📍  Content',
    options: [
      option('lineupEditS1', 'lineup:edit:S1'),
      option('lineupEditS2', 'lineup:edit:S2'),
      option('serverPostS1', 'server:post:S1'),
      option('serverPostS2', 'server:post:S2'),
      option('serverEditS1', 'server:edit:S1'),
      option('serverEditS2', 'server:edit:S2'),
      option('nodesEdit', 'nodes:edit'),
    ],
  },
  {
    id: 'admin_rotation_select',
    placeholder: '🗺️  Map Rotation',
    options: [
      option('rotationEdit', 'edit'),
      option('rotationAdvance', 'advance'),
      option('rotationReset', 'reset'),
      option('rotationUndo', 'undo'),
    ],
  },
  {
    id: 'admin_signups_select',
    placeholder: '📅  Signups',
    options: [
      option('signupsSync', 'sync'),
      option('signupsToggle', 'toggle'),
      option('signupsCancel', 'cancel'),
    ],
  },
  {
    id: 'admin_danger_select',
    placeholder: '⚠️  Destructive',
    options: [option('factionReset', 'faction:reset'), option('clearlogs', 'clearlogs')],
  },
];

// ── Buttons (the container layout only) ──────────────────────────────────────

/**
 * The one-click action each feature row carries as its section accessory. Only
 * actions that need no parameter and no confirmation qualify — a Section takes
 * exactly one accessory, so this is the feature's "do the obvious thing".
 *
 * @typedef {Object} SectionAction
 * @property {string} feature
 * @property {string} customId
 * @property {string} label
 * @property {string} emoji
 *
 * @type {SectionAction[]}
 */
const SECTION_ACTIONS = [
  { feature: 'faction',  customId: 'admin_faction_reload', label: 'Reload', emoji: '🔄' },
  { feature: 'rotation', customId: 'admin_rotation_sync',  label: 'Sync',   emoji: '📤' },
  { feature: 'nodes',    customId: 'admin_nodes_post',     label: 'Post',   emoji: '📤' },
  { feature: 'midcap',   customId: 'admin_midcap_post',    label: 'Poll',   emoji: '📊' },
  { feature: 'signups',  customId: 'admin_signups_post',   label: 'Post',   emoji: '📮' },
];

/** The diagnostics row, never gated: a broken .env is when it is needed most. */
const UTILITY_BUTTONS = [
  { customId: 'admin_panel_refresh',   label: 'Refresh',          emoji: '🔄' },
  { customId: 'admin_healthcheck_run', label: 'Healthcheck',      emoji: '🩺' },
  { customId: 'admin_postall',         label: 'Post all missing', emoji: '📮' },
];

// ── Building ─────────────────────────────────────────────────────────────────

/** @param {PanelOption} option */
function optionEnabled(option) {
  if (option.feature && !isConfigured(option.feature)) return false;
  if (option.requires && !hasEnv(option.requires)) return false;
  return true;
}

/** The options of one menu that this environment can actually use. */
function enabledOptions(menu) {
  return menu.options.filter(optionEnabled);
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

/**
 * The select rows for a layout, in display order, minus anything unusable.
 * @param {PanelMenu[]} [menus]
 */
function buildPanelComponents(menus = MENUS_V1) {
  const rows = menus
    .map(menu => ({ menu, options: enabledOptions(menu) }))
    .filter(({ options }) => options.length > 0)
    .map(({ menu, options }) => buildMenuRow(menu, options));

  if (rows.length > MAX_ROWS) {
    throw new Error(`Panel needs ${rows.length} component rows; Discord allows ${MAX_ROWS}.`);
  }
  return rows;
}

/** @param {string} featureKey */
function sectionAction(featureKey) {
  return SECTION_ACTIONS.find(action => action.feature === featureKey) ?? null;
}

/** @param {{customId: string, label: string, emoji: string}} spec */
function actionButton(spec) {
  return new ButtonBuilder()
    .setCustomId(spec.customId)
    .setLabel(spec.label)
    .setEmoji(spec.emoji)
    .setStyle(ButtonStyle.Secondary);
}

/** The Refresh / Healthcheck / Post-all row. */
function buildUtilityRow() {
  return new ActionRowBuilder().addComponents(UTILITY_BUTTONS.map(actionButton));
}

/**
 * The customIds that sit *on the panel message*. A component interaction with
 * one of these can redraw the panel through its own token; anything else (a
 * confirm dialog, an edit preview) lives on a different message and cannot.
 */
const PANEL_CONTROL_IDS = new Set([
  ...MENUS_V1.map(menu => menu.id),
  ...MENUS_V2.map(menu => menu.id),
  ...SECTION_ACTIONS.map(action => action.customId),
  ...UTILITY_BUTTONS.map(button => button.customId),
]);

module.exports = {
  ACTIONS,
  MENUS_V1,
  MENUS_V2,
  MAX_ROWS,
  MAX_OPTIONS,
  SECTION_ACTIONS,
  UTILITY_BUTTONS,
  optionEnabled,
  enabledOptions,
  buildPanelComponents,
  sectionAction,
  actionButton,
  buildUtilityRow,
  PANEL_CONTROL_IDS,
};
