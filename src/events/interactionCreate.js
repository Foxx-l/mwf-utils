/**
 * interactionCreate.js — Central router for all Discord interactions.
 *
 * Business logic lives in the handlers/interactions/ modules; this file is
 * purely responsible for dispatching to the right handler.
 */

const { PermissionFlagsBits } = require('discord.js');
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
  handleAdminAdvanceRotation
} = require('../handlers/interactions/rotationHandler');
const { handleAdminPostAllMissing } = require('../handlers/interactions/postAllHandler');
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
const { refreshPanelMessage } = require('../commands/admin/panel');

// ── Helpers ──────────────────────────────────────────────────────────────────
// Runs the underlying handler and records the admin action in the lastAction
// store. The panel does NOT auto-refresh after actions — admins use the
// Refresh control in the Panel dropdown (or re-run /panel) to redraw status.
// This was removed because Discord kept the last-selected dropdown option
// visible even after the message was edited, which looked like the panel
// was "remembering" the selection.

async function trackAction(interaction, label, fn) {
  const result = await fn();
  // Handlers may return `false` to signal "nothing was performed" (e.g.
  // cooldown-blocked, preview expired). Skip the audit-log entry so the
  // footer doesn't show a phantom "last action" for work that never happened.
  if (result === false) return;
  // Handlers may also return `{ server }` to tag the action with the
  // specific server (S1/S2) so the panel footer shows "Edit Lineup — S1".
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

async function rejectUnlistedGuild(interaction) {
  const reply = { content: '⛔ This bot is not available on this server.', flags: 64 };
  try {
    if (interaction.isRepliable?.()) {
      await interaction.reply(reply);
    }
  } catch (err) {
    logger.debug(`rejectUnlistedGuild: ${err.message}`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {

    // Enforce the optional ALLOWED_GUILDS gate before any handler runs.
    if (interaction.guildId && !guildAllowed(interaction.guildId)) {
      logger.warn(`Rejected interaction from unlisted guild ${interaction.guildId}`);
      return rejectUnlistedGuild(interaction);
    }

    // ── Slash Commands ──────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (error) {
        logger.error(`Error executing /${interaction.commandName}:`, error);
        const reply = { content: '❌ An error occurred.', flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    // ── Modal Submits ───────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      try {
        // Modal submits now show a preview + Apply/Cancel. lastAction is
        // written when the admin clicks Apply (in the button handlers below),
        // so we don't wrap these in trackAction.
        if (interaction.customId.startsWith('lineup_caption:')) {
          return await handleLineupCaptionSubmit(interaction);
        }
        if (interaction.customId.startsWith('lineup_server:')) {
          return await handleServerModalSubmit(interaction);
        }
        if (interaction.customId === 'nodes_edit') {
          return await handleNodesModalSubmit(interaction);
        }
        if (interaction.customId.startsWith('rotation_edit:')) {
          // Modal submit now shows a preview instead of saving directly;
          // the lastAction entry is written when the admin clicks Apply.
          return await handleRotationModalSubmit(interaction);
        }
      } catch (error) {
        logger.error('Error handling modal submit:', error);
        const reply = { content: '❌ An error occurred.', flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    // ── String Select Menus ────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      try {
        if (interaction.customId.startsWith('admin_')) {
          if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
              embeds: [createErrorEmbed('Permission Denied', 'Only administrators can use these controls.')],
              flags: 64
            });
          }
          const value = interaction.values[0] || '';

          if (interaction.customId === 'admin_faction_select') {
            if (value === 'reload') {
              return await trackAction(
                interaction,
                'Reload Faction Embed',
                () => handleAdminReload(interaction),
              );
            }
            // Reset only opens the confirm dialog — recorded when user confirms.
            if (value === 'reset') return await handleAdminResetConfirm(interaction);
          }

          if (interaction.customId === 'admin_lineup_select') {
            const [action, server] = value.split(':');
            // Edit only opens a modal — recorded on modal submit.
            if (action === 'edit') return await handleAdminEditCaption(interaction, server);
          }

          if (interaction.customId === 'admin_server_select') {
            const [action, server] = value.split(':');
            if (action === 'post') {
              return await trackAction(
                interaction,
                server ? `Post Server Details — ${server}` : 'Post Server Details',
                () => handleAdminPostServer(interaction, server),
              );
            }
            if (action === 'edit') return await handleAdminEditServer(interaction, server);
          }

          if (interaction.customId === 'admin_rotnodes_select') {
            if (value === 'rotation:post') {
              return await trackAction(
                interaction,
                'Post Map Rotation',
                () => handleAdminPostRotation(interaction),
              );
            }
            if (value === 'rotation:edit') return await handleAdminEditRotation(interaction);
            if (value === 'rotation:advance') {
              return await trackAction(
                interaction,
                'Advance Rotation',
                () => handleAdminAdvanceRotation(interaction),
              );
            }
            if (value === 'nodes:post') {
              return await trackAction(
                interaction,
                'Post Nodes',
                () => handleAdminPostNodes(interaction),
              );
            }
            if (value === 'nodes:edit')    return await handleAdminEditNodes(interaction);
          }

          if (interaction.customId === 'admin_panel_select') {
            if (value === 'refresh') {
              // The only path that redraws the panel. Ack + rebuild + edit.
              await interaction.deferUpdate();
              return await refreshPanelMessage(interaction);
            }
            if (value === 'postall') {
              return await trackAction(
                interaction,
                'Post All Missing',
                () => handleAdminPostAllMissing(interaction),
              );
            }
            if (value === 'healthcheck') {
              return await handleAdminHealthcheck(interaction);
            }
            // Clear logs only opens confirm — recorded when user confirms.
            if (value === 'clearlogs') return await handleAdminClearLogsConfirm(interaction);
          }
        }
      } catch (error) {
        logger.error('Error handling select menu:', error);
        const reply = { content: '❌ An error occurred.', flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    if (!interaction.isButton()) return;

    const { customId } = interaction;

    try {
      // ── Lineup / Server buttons ───────────────────────────────────────────
      if (customId.startsWith('lineup_editcap:'))    return await handleLineupEditCapButton(interaction);
      if (customId.startsWith('lineup_editserver:')) return await handleLineupEditServerButton(interaction);

      // ── Faction buttons ───────────────────────────────────────────────────
      if (customId.startsWith('faction_')) {
        const factionKey = customId.slice('faction_'.length);
        return await handleFactionSelection(interaction, factionKey);
      }

      // ── Admin buttons (ephemeral confirm dialogs for destructive ops) ─────
      // All other admin controls live in the panel dropdowns; these two
      // customIds are created by handleAdminResetConfirm / handleAdminClearLogsConfirm
      // as inline Confirm/Cancel buttons on an ephemeral reply.
      if (customId.startsWith('admin_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            embeds: [createErrorEmbed('Permission Denied', 'Only administrators can use these controls.')],
            flags: 64
          });
        }

        if (customId === 'admin_reset_confirm') {
          return await trackAction(
            interaction,
            'Reset Roles',
            () => handleAdminReset(interaction),
          );
        }
        if (customId === 'admin_reset_cancel')       return await handleAdminResetCancel(interaction);
        if (customId === 'admin_clearlogs_confirm') {
          return await trackAction(
            interaction,
            'Clear Log Channel',
            () => handleAdminClearLogs(interaction),
          );
        }
        if (customId === 'admin_clearlogs_cancel')   return await handleAdminClearLogsCancel(interaction);
        if (customId === 'admin_healthcheck_autofix') return await handleAdminHealthcheckAutofix(interaction);
      }

      // ── Preview Apply / Cancel (per-flow namespace) ───────────────────────
      if (customId.startsWith('rotation_apply:')) {
        return await trackAction(
          interaction,
          'Edit Map Rotation',
          () => handleRotationApplyButton(interaction),
        );
      }
      if (customId.startsWith('rotation_cancel:')) {
        return await handleRotationCancelButton(interaction);
      }
      if (customId.startsWith('nodes_apply:')) {
        return await trackAction(
          interaction,
          'Edit Nodes',
          () => handleNodesApplyButton(interaction),
        );
      }
      if (customId.startsWith('nodes_cancel:')) {
        return await handleNodesCancelButton(interaction);
      }
      if (customId.startsWith('lineup_caption_apply:')) {
        return await trackAction(
          interaction,
          'Edit Lineup',
          () => handleLineupCaptionApplyButton(interaction),
        );
      }
      if (customId.startsWith('lineup_caption_cancel:')) {
        return await handleLineupCaptionCancelButton(interaction);
      }
      if (customId.startsWith('lineup_server_apply:')) {
        return await trackAction(
          interaction,
          'Edit Server Details',
          () => handleServerApplyButton(interaction),
        );
      }
      if (customId.startsWith('lineup_server_cancel:')) {
        return await handleServerCancelButton(interaction);
      }

    } catch (error) {
      logger.error('Error handling button interaction:', error);
      const reply = { content: '❌ An error occurred.', flags: 64 };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  }
};
