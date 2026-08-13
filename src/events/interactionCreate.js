// @ts-check
/**
 * interactionCreate.js — Central router for all Discord interactions.
 *
 * Table-driven dispatch: each interaction kind has a route table mapping
 * customId (plus select-menu value, where relevant) to a handler. Adding a
 * flow means adding a row — the dispatcher, the admin permission gate and
 * the audit-log wrapping are shared, so they can't drift per handler.
 *
 * Slash commands and their autocomplete are the exception: they dispatch by
 * command name straight into the command module (`execute` / `autocomplete`).
 *
 * Route entry fields:
 *   id         exact customId match
 *   prefix     customId prefix match (use one or the other)
 *   value      exact select-menu value match        (select routes only)
 *   valuePrefix select-menu value prefix match      (select routes only)
 *   admin      require Administrator permission before running
 *   adminMsg   custom denial text (defaults to ADMIN_CONTROLS_MSG)
 *   track      audit-log label (string, or fn(interaction) → string);
 *              when set, the handler runs inside trackAction()
 *   run        the handler: (interaction) => Promise<*>
 */

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { createErrorEmbed } = require('../utils/embeds');
const { saveLastAction }   = require('../utils/lastActionStore');

// ── Handler imports ───────────────────────────────────────────────────────────
const { handleFactionSelection }                         = require('../handlers/interactions/factionHandler');
const {
  handleLineupEditCapButton,
  handleLineupCaptionSubmit,
  handleLineupCaptionApplyButton,
  handleLineupCaptionCancelButton,
  handleLineupEditServerButton,
  handleServerModalSubmit,
  handleServerApplyButton,
  handleServerCancelButton,
  handleAdminPostServer,
  handleAdminEditCaption,
  handleAdminEditServer
} = require('../handlers/interactions/lineupHandler');
const {
  handleNodesModalSubmit,
  handleNodesApplyButton,
  handleNodesCancelButton,
  handleAdminPostNodes,
  handleAdminEditNodes,
} = require('../handlers/interactions/nodesHandler');
const {
  handleRotationModalSubmit,
  handleRotationApplyButton,
  handleRotationCancelButton,
  handleAdminPostRotation,
  handleAdminEditRotation,
  handleAdminAdvanceConfirm,
  handleAdminAdvanceRotation,
  handleAdminResetConfirm: handleRotationResetConfirm,
  handleAdminResetRotation: handleRotationReset,
  handleAdminUndoRotation,
  handleRotationActionCancel,
} = require('../handlers/interactions/rotationHandler');
const { handleAdminPostAllMissing } = require('../handlers/interactions/postAllHandler');
const { handleAdminPostMidCapPoll } = require('../handlers/interactions/midCapHandler');
const {
  handleTeamRepApprove,
  handleTeamRepReject,
} = require('../handlers/interactions/teamrepHandler');
const {
  handleAdminSignupsOpen,
  handleAdminSignupsRefresh,
  handleAdminSignupsPost,
  handleAdminSignupsSync,
  handleAdminSignupsToggle,
  handleAdminSignupsCancelConfirm,
  handleAdminSignupsCancel,
  handleAdminSignupsCancelCancel,
} = require('../handlers/interactions/signupHandler');
const {
  handleAdminResetConfirm,
  handleAdminResetCancel,
  handleAdminReset,
  handleAdminReload,
  handleAdminClearLogsConfirm,
  handleAdminClearLogsCancel,
  handleAdminClearLogs,
  handleAdminHealthcheck,
  handleAdminHealthcheckAutofix,
} = require('../handlers/interactions/adminHandler');
const { refreshPanelMessage } = require('../panel/refresh');

// ── Shared plumbing ───────────────────────────────────────────────────────────

const ADMIN_CONTROLS_MSG = 'Only administrators can use these controls.';
const ADMIN_ROTATION_MSG = 'Administrator permission is required.';

/**
 * Runs the underlying handler and records the admin action in the lastAction
 * store. Handlers may return `false` ("nothing performed") to skip the audit
 * entry, or `{ server }` to tag the action with S1/S2 in the panel footer.
 *
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {string} label
 * @param {() => Promise<*>} fn
 */
async function trackAction(interaction, label, fn) {
  const result = await fn();
  if (result === false) return;
  const suffix = result && typeof result === 'object' && result.server
    ? ` — ${result.server}`
    : '';
  saveLastAction(`${label}${suffix}`, interaction.user.id, interaction.user.tag);
}

// ── Guild allowlist ───────────────────────────────────────────────────────────
// Optional hard gate: if ALLOWED_GUILDS is set, only interactions from those
// guild IDs are processed. Protects the bot from responding on servers it
// was invited to by mistake.
function guildAllowed(guildId) {
  const raw = process.env.ALLOWED_GUILDS;
  if (!raw || !String(raw).trim()) return true;
  const allowed = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(String(guildId ?? ''));
}

/** @param {import('discord.js').RepliableInteraction} interaction */
async function rejectUnlistedGuild(interaction) {
  /** @type {import('discord.js').InteractionReplyOptions} */
  const reply = { content: '⛔ This bot is not available on this server.', flags: MessageFlags.Ephemeral };
  try {
    if (interaction.isRepliable?.()) {
      await interaction.reply(reply);
    }
  } catch (err) {
    logger.debug(`rejectUnlistedGuild: ${err.message}`);
  }
}

/** @param {import('discord.js').Interaction} interaction */
function isAdmin(interaction) {
  const member = /** @type {import('discord.js').GuildMember} */ (interaction.member);
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

/**
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {string} message
 */
async function denyAdmin(interaction, message) {
  return interaction.reply({
    embeds: [createErrorEmbed('Permission Denied', message)],
    flags: MessageFlags.Ephemeral
  });
}

// ── Route tables ──────────────────────────────────────────────────────────────

const MODAL_ROUTES = [
  { prefix: 'lineup_caption:', run: handleLineupCaptionSubmit },
  { prefix: 'lineup_server:',  run: handleServerModalSubmit },
  { id: 'nodes_edit',          run: handleNodesModalSubmit },
  { prefix: 'rotation_edit:',  run: handleRotationModalSubmit },
];

// Every select menu in this bot is an admin control; the dispatcher gates
// any `admin_*` customId before value matching, exactly like the old code.
const SELECT_ROUTES = [
  { id: 'admin_faction_select', value: 'reload', track: 'Reload Faction Embed', run: handleAdminReload },
  { id: 'admin_faction_select', value: 'reset',  run: handleAdminResetConfirm },

  { id: 'admin_lineup_select', valuePrefix: 'edit:',
    run: i => handleAdminEditCaption(i, i.values[0].split(':')[1]) },

  { id: 'admin_server_select', valuePrefix: 'post:',
    track: i => {
      const server = i.values[0].split(':')[1];
      return server ? `Post Server Details — ${server}` : 'Post Server Details';
    },
    run: i => handleAdminPostServer(i, i.values[0].split(':')[1]) },
  { id: 'admin_server_select', valuePrefix: 'edit:',
    run: i => handleAdminEditServer(i, i.values[0].split(':')[1]) },

  { id: 'admin_rotnodes_select', value: 'rotation:sync',    track: 'Sync Map Rotation',   run: handleAdminPostRotation },
  { id: 'admin_rotnodes_select', value: 'rotation:edit',    run: handleAdminEditRotation },
  { id: 'admin_rotnodes_select', value: 'rotation:advance', run: handleAdminAdvanceConfirm },
  { id: 'admin_rotnodes_select', value: 'rotation:reset',   run: handleRotationResetConfirm },
  { id: 'admin_rotnodes_select', value: 'rotation:undo',    track: 'Undo Rotation',       run: handleAdminUndoRotation },
  { id: 'admin_rotnodes_select', value: 'nodes:post',       track: 'Post Nodes',          run: handleAdminPostNodes },
  { id: 'admin_rotnodes_select', value: 'nodes:edit',       run: handleAdminEditNodes },

  { id: 'admin_panel_select', value: 'refresh',
    run: async i => { await i.deferUpdate(); return refreshPanelMessage(i); } },
  { id: 'admin_panel_select', value: 'postall',     track: 'Post All Missing', run: handleAdminPostAllMissing },
  { id: 'admin_panel_select', value: 'midcap',      track: 'Post Mid Cap Poll', run: handleAdminPostMidCapPoll },
  { id: 'admin_panel_select', value: 'signups',     run: handleAdminSignupsOpen },
  { id: 'admin_panel_select', value: 'healthcheck', run: handleAdminHealthcheck },
  { id: 'admin_panel_select', value: 'clearlogs',   run: handleAdminClearLogsConfirm },

  // Signups sub-panel (its own ephemeral message opened from the panel)
  { id: 'admin_signups_select', value: 'post',    track: 'Post Signups',            run: handleAdminSignupsPost },
  { id: 'admin_signups_select', value: 'sync',    track: 'Sync Signup Channels',    run: handleAdminSignupsSync },
  { id: 'admin_signups_select', value: 'toggle',  track: 'Toggle Signup Auto-Post', run: handleAdminSignupsToggle },
  { id: 'admin_signups_select', value: 'cancel',  run: handleAdminSignupsCancelConfirm },
  { id: 'admin_signups_select', value: 'refresh', run: handleAdminSignupsRefresh },
];

const BUTTON_ROUTES = [
  // Member-facing flows (ephemeral replies keep the buttons admin-only in practice)
  { prefix: 'lineup_editcap:',    run: handleLineupEditCapButton },
  { prefix: 'lineup_editserver:', run: handleLineupEditServerButton },
  { prefix: 'faction_',
    run: i => handleFactionSelection(i, i.customId.slice('faction_'.length)) },

  // Team Rep approval queue (admins decide yes/no on each request)
  { prefix: 'teamrep_approve:', admin: true, run: handleTeamRepApprove },
  { prefix: 'teamrep_reject:',  admin: true, run: handleTeamRepReject },

  // Destructive admin controls (ephemeral confirm dialogs)
  { id: 'admin_reset_confirm',     admin: true, track: 'Reset Roles',       run: handleAdminReset },
  { id: 'admin_reset_cancel',      admin: true, run: handleAdminResetCancel },
  { id: 'admin_clearlogs_confirm', admin: true, track: 'Clear Log Channel', run: handleAdminClearLogs },
  { id: 'admin_clearlogs_cancel',  admin: true, run: handleAdminClearLogsCancel },
  { id: 'admin_signups_cancel_confirm', admin: true, track: 'Cancel Signups', run: handleAdminSignupsCancel },
  { id: 'admin_signups_cancel_cancel',  admin: true, run: handleAdminSignupsCancelCancel },
  { id: 'admin_healthcheck_autofix', admin: true, run: handleAdminHealthcheckAutofix },

  // Confirmed rotation actions
  { id: 'rotation_advance_confirm', admin: true, adminMsg: ADMIN_ROTATION_MSG, track: 'Advance Rotation', run: handleAdminAdvanceRotation },
  { id: 'rotation_reset_confirm',   admin: true, adminMsg: ADMIN_ROTATION_MSG, track: 'Reset Rotation',   run: handleRotationReset },
  { id: 'rotation_action_cancel',   admin: true, adminMsg: ADMIN_ROTATION_MSG, run: handleRotationActionCancel },

  // Preview Apply / Cancel (per-flow namespace; ownership enforced in pendingEdits)
  { prefix: 'rotation_apply:',       track: 'Edit Map Rotation',   run: handleRotationApplyButton },
  { prefix: 'rotation_cancel:',      run: handleRotationCancelButton },
  { prefix: 'nodes_apply:',          track: 'Edit Nodes',          run: handleNodesApplyButton },
  { prefix: 'nodes_cancel:',         run: handleNodesCancelButton },
  { prefix: 'lineup_caption_apply:', track: 'Edit Lineup',         run: handleLineupCaptionApplyButton },
  { prefix: 'lineup_caption_cancel:', run: handleLineupCaptionCancelButton },
  { prefix: 'lineup_server_apply:',  track: 'Edit Server Details', run: handleServerApplyButton },
  { prefix: 'lineup_server_cancel:', run: handleServerCancelButton },

  // Catch-all so unknown `admin_*` buttons still hit the permission gate
  // (mirrors the old startsWith('admin_') branch).
  { prefix: 'admin_', admin: true, run: async () => {} },
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * First route whose customId and (for selects) value match.
 * @param {Array<Object>} routes
 * @param {string} customId
 * @param {string} [value]
 */
function findRoute(routes, customId, value = '') {
  return routes.find(route =>
    (route.id ? route.id === customId : route.prefix ? customId.startsWith(route.prefix) : false) &&
    (route.value ? route.value === value : route.valuePrefix ? value.startsWith(route.valuePrefix) : true)
  ) ?? null;
}

/**
 * Enforces the route's admin gate, then runs it — wrapped in trackAction()
 * when the route declares an audit-log label.
 * @param {Object} route
 * @param {import('discord.js').RepliableInteraction} interaction
 */
async function runRoute(route, interaction) {
  if (route.admin && !isAdmin(interaction)) {
    return denyAdmin(interaction, route.adminMsg ?? ADMIN_CONTROLS_MSG);
  }
  if (route.track) {
    const label = typeof route.track === 'function' ? route.track(interaction) : route.track;
    return trackAction(interaction, label, () => route.run(interaction));
  }
  return route.run(interaction);
}

/** Uniform "something threw" reply, matching the old per-section catches. */
/** @param {import('discord.js').RepliableInteraction} interaction */
async function failSafe(interaction, error, context) {
  logger.error(`Error handling ${context}:`, error);
  // Autocomplete has no reply channel; the client just shows no suggestions.
  if (interaction.isAutocomplete?.()) return;
  /** @type {import('discord.js').InteractionReplyOptions} */
  const reply = { content: '❌ An error occurred.', flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(reply).catch(() => {});
  } else {
    await interaction.reply(reply).catch(() => {});
  }
}

/**
 * Autocomplete dispatch: a command with autocompleted options exports
 * `autocomplete(interaction)` next to `execute`. Commands without one still get
 * an empty response so the client does not sit on "loading options".
 * @param {import('discord.js').AutocompleteInteraction} interaction
 */
async function handleAutocomplete(interaction) {
  const client = /** @type {import('../index').MwfClient} */ (interaction.client);
  const command = client.commands.get(interaction.commandName);
  if (!command?.autocomplete) return interaction.respond([]);
  return command.autocomplete(interaction);
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = {
  name: 'interactionCreate',

  /** @param {import('discord.js').RepliableInteraction} interaction */
  async execute(interaction) {

    // Autocomplete is the one kind that cannot be replied to, so it is picked
    // out up front and handled through its own (non-repliable) type.
    const autocomplete = interaction.isAutocomplete?.()
      ? /** @type {import('discord.js').AutocompleteInteraction} */ (/** @type {*} */ (interaction))
      : null;

    // Enforce the optional ALLOWED_GUILDS gate before any handler runs.
    if (interaction.guildId && !guildAllowed(interaction.guildId)) {
      logger.warn(`Rejected interaction from unlisted guild ${interaction.guildId}`);
      // Answer autocomplete with an empty list so the client stops waiting
      // instead of showing "loading options" forever.
      if (autocomplete) return autocomplete.respond([]).catch(() => {});
      return rejectUnlistedGuild(interaction);
    }

    try {
      // ── Autocomplete ──────────────────────────────────────────────────────
      if (autocomplete) return await handleAutocomplete(autocomplete);

      // ── Slash Commands ────────────────────────────────────────────────────
      if (interaction.isChatInputCommand()) {
        // client.commands is attached in src/index.js (see MwfClient there).
        const client = /** @type {import('../index').MwfClient} */ (interaction.client);
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        return await command.execute(interaction);
      }

      // ── Modal Submits ─────────────────────────────────────────────────────
      if (interaction.isModalSubmit()) {
        const route = findRoute(MODAL_ROUTES, interaction.customId);
        if (route) return await runRoute(route, interaction);
        return;
      }

      // ── String Select Menus (all admin controls) ──────────────────────────
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('admin_') && !isAdmin(interaction)) {
          return denyAdmin(interaction, ADMIN_CONTROLS_MSG);
        }
        const route = findRoute(SELECT_ROUTES, interaction.customId, interaction.values[0] || '');
        if (route) return await runRoute(route, interaction);
        return;
      }

      if (!interaction.isButton()) return;

      // ── Buttons ───────────────────────────────────────────────────────────
      const route = findRoute(BUTTON_ROUTES, interaction.customId);
      if (route) return await runRoute(route, interaction);

    } catch (error) {
      const where = interaction.isChatInputCommand()
        ? `/${interaction.commandName}`
        : `interaction ${'customId' in interaction ? interaction.customId : ''}`;
      return failSafe(interaction, error, where);
    }
  },

  // Exported for tests
  findRoute,
  MODAL_ROUTES,
  SELECT_ROUTES,
  BUTTON_ROUTES,
};
