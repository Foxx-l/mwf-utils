// @ts-check
/**
 * refresh.js — Redraws the panel after an admin action.
 *
 * The panel is an **ephemeral** message, and ephemeral messages can only be
 * edited through the interaction token that produced them: `interaction
 * .editReply()`, which is `PATCH /webhooks/{app}/{token}/messages/@original`.
 * The old code called `interaction.message.edit()` — `PATCH /channels/{c}/
 * messages/{m}` — which Discord rejects for ephemerals, and swallowed the error,
 * so "Refresh Status" quietly did nothing and every action left a stale panel.
 *
 * Two conditions make `editReply` land on the panel:
 *   1. the interaction is a component **on the panel message** (a confirm
 *      dialog or an edit preview is a different message and cannot be used), and
 *   2. it was acked with `deferUpdate()`, not `deferReply()` — after a
 *      `deferReply` the "@original" message is the handler's own new ephemeral
 *      reply, so editing it would replace the admin's result with the panel.
 *
 * Hence the two entry points: `refreshPanel` for the explicit Refresh action
 * (failures are the point of the click, so they surface), and
 * `refreshPanelSafely` for the automatic redraw after another action (failures
 * must never bury the result of the thing that actually worked).
 */

const { MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { PANEL_CONTROL_IDS } = require('./controls');
const { buildPanelPayload } = require('./payload');

/**
 * Why this interaction cannot redraw the panel, or `null` when it can.
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @returns {string|null}
 */
function panelRefreshBlocker(interaction) {
  if (!interaction?.isMessageComponent?.()) return 'not a message-component interaction';
  if (!PANEL_CONTROL_IDS.has(interaction.customId)) return `${interaction.customId} is not a control on the panel message`;
  if (!interaction.deferred && !interaction.replied) return 'interaction must be acked with deferUpdate() first';
  return null;
}

/**
 * Redraws the panel. Throws when it cannot — the caller is the router, whose
 * failSafe logs the stack and tells the admin something went wrong.
 * @param {import('discord.js').MessageComponentInteraction} interaction
 */
async function refreshPanel(interaction) {
  const blocker = panelRefreshBlocker(interaction);
  if (blocker) throw new Error(`Cannot refresh the panel: ${blocker}`);
  const payload = await buildPanelPayload(interaction.client, interaction.guildId);
  await interaction.editReply(payload);
}

/**
 * Redraws the panel as a side effect of another action. Never throws, but never
 * silent either: an interaction that simply cannot refresh (a confirm dialog,
 * say) is a debug line, while a refresh that was supposed to work and failed is
 * a warning plus a note to the admin, so a stale panel is never mistaken for
 * a fresh one.
 * @param {import('discord.js').MessageComponentInteraction} interaction
 */
async function refreshPanelSafely(interaction) {
  const blocker = panelRefreshBlocker(interaction);
  if (blocker) {
    logger.debug(`Panel not refreshed — ${blocker}`);
    return;
  }
  try {
    const payload = await buildPanelPayload(interaction.client, interaction.guildId);
    await interaction.editReply(payload);
  } catch (err) {
    logger.warn(`Panel refresh failed: ${err.message}`);
    await interaction.followUp({
      content: '⚠️ The action ran, but the panel above could not be refreshed — reopen `/panel` for current status.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

module.exports = { refreshPanel, refreshPanelSafely, panelRefreshBlocker };
