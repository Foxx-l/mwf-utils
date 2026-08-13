// @ts-check
/**
 * refresh.js — Redraws the panel after an admin action.
 *
 * Moved here from the command module unchanged; the next commit fixes the API
 * path it uses.
 */

const { buildPanelPayload } = require('./payload');

async function refreshPanelMessage(interaction) {
  try {
    const msg = interaction.message;
    if (!msg) return;
    const payload = await buildPanelPayload(interaction.client, interaction.guildId);
    await msg.edit(payload);
  } catch (_) { /* best effort */ }
}

module.exports = { refreshPanelMessage };
