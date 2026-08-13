// @ts-check
/**
 * /panel — the admin control panel.
 *
 * A thin command: everything it shows and everything it can do lives in
 * `src/panel/`, because the router and "post all missing" need the same pieces
 * and a command module is the wrong place to import from.
 */

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPanelPayload } = require('../../panel/payload');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the admin control panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = await buildPanelPayload(interaction.client, interaction.guildId);
    await interaction.editReply(payload);
  },
};
