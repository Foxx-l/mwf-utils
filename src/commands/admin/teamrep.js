const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../utils/logger');
const { sendLog } = require('../../handlers/interactions/shared');
// assignTeamRep is exported from the messageCreate handler module
const { assignTeamRep } = require('../../events/messageCreate.teamrep');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamrep')
    .setDescription('Manage Team Rep role')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc.setName('add').setDescription('Assign Team Rep role to a member')
      .addUserOption(o => o.setName('member').setDescription('Member to assign').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Remove Team Rep role from a member')
      .addUserOption(o => o.setName('member').setDescription('Member to remove').setRequired(true))),

  async execute(interaction) {
    // Defer early because role operations can take >3s (Discord times out the interaction otherwise)
    await interaction.deferReply({ ephemeral: true });

    const roleId = process.env.TEAM_REP_ROLE_ID;
    if (!roleId) return interaction.editReply({ content: 'TEAM_REP_ROLE_ID is not configured.' });

    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('member');
    const guildMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!guildMember) return interaction.editReply({ content: 'Could not find that member in the guild.' });

    if (sub === 'add') {
      try {
        const res = await assignTeamRep(interaction, guildMember, roleId);
        if (res && res.success) {
          await interaction.editReply({ content: `Assigned Team Rep role to ${user.tag}.` });
          if (process.env.ADMIN_LOG_CHANNEL) {
            const embed = {
              title: 'Team Rep (manual) Assigned',
              description: `${user.tag} was given the Team Rep role by ${interaction.user.tag}`,
              timestamp: new Date()
            };
            sendLog(interaction.client, embed).catch(() => {});
          }
        } else {
          await interaction.editReply({ content: `Failed to assign role: ${res.reason || res.error?.message || 'unknown'}` });
        }
      } catch (err) {
        logger.warn(`teamrep add command failed: ${err.message}`);
        await interaction.editReply({ content: `Error: ${err.message}` });
      }
    } else if (sub === 'remove') {
      try {
        await guildMember.roles.remove(roleId);
        await interaction.editReply({ content: `Removed Team Rep role from ${user.tag}.` });
        if (process.env.ADMIN_LOG_CHANNEL) {
          const embed = {
            title: 'Team Rep (manual) Removed',
            description: `${user.tag} had the Team Rep role removed by ${interaction.user.tag}`,
            timestamp: new Date()
          };
          sendLog(interaction.client, embed).catch(() => {});
        }
      } catch (err) {
        logger.warn(`teamrep remove failed: ${err.message}`);
        await interaction.editReply({ content: `Failed to remove role: ${err.message}` });
      }
    }
  }
};
