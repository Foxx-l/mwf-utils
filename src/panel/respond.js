// @ts-check
/**
 * respond.js — How a panel action answers, so the panel can be redrawn.
 *
 * The panel is ephemeral, and the only way to edit it is `editReply` on an
 * interaction whose "@original" message *is* the panel. That holds after
 * `deferUpdate()` and stops holding after `deferReply()`, which makes
 * "@original" the handler's own new reply instead.
 *
 * So an action triggered from a panel control acks with `deferUpdate()` and
 * reports its result as an ephemeral `followUp()`, leaving the panel free for
 * the router to redraw. The same handler reached from anywhere else keeps the
 * plain ephemeral reply. Both decisions come from one predicate, so they cannot
 * disagree.
 */

const { MessageFlags } = require('discord.js');
const { PANEL_CONTROL_IDS } = require('./controls');

/**
 * Is this interaction a control sitting on the panel message?
 * @param {*} interaction
 */
function ownsPanelMessage(interaction) {
  return Boolean(
    interaction?.isMessageComponent?.() &&
    PANEL_CONTROL_IDS.has(interaction.customId)
  );
}

/**
 * Acknowledge the interaction before doing slow work.
 * @param {*} interaction
 */
async function ackPanelAction(interaction) {
  if (ownsPanelMessage(interaction)) return interaction.deferUpdate();
  return interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

/**
 * Report an action's outcome to the admin, without touching the panel.
 * @param {*} interaction
 * @param {import('discord.js').InteractionReplyOptions} payload
 */
async function reportPanelResult(interaction, payload) {
  if (ownsPanelMessage(interaction)) {
    return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  }
  return interaction.editReply(payload);
}

module.exports = { ownsPanelMessage, ackPanelAction, reportPanelResult };
