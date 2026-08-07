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
    const roleId = process.env.TEAM_REP_ROLE_ID;
    if (!roleId) return interaction.reply({ content: 'TEAM_REP_ROLE_ID is not configured.', flags: 64, ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('member');
    const guildMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!guildMember) return interaction.reply({ content: 'Could not find that member in the guild.', ephemeral: true });

    if (sub === 'add') {
      try {
        const res = await assignTeamRep(interaction, guildMember, roleId);
        if (res && res.success) {
          await interaction.reply({ content: `Assigned Team Rep role to ${user.tag}.`, ephemeral: true });
          if (process.env.ADMIN_LOG_CHANNEL) {
            const embed = {
              title: 'Team Rep (manual) Assigned',
              description: `${user.tag} was given the Team Rep role by ${interaction.user.tag}`,
              timestamp: new Date()
            };
            sendLog(interaction.client, embed).catch(() => {});
          }
        } else {
          await interaction.reply({ content: `Failed to assign role: ${res.reason || res.error?.message || 'unknown'}`, ephemeral: true });
        }
      } catch (err) {
        logger.warn(`teamrep add command failed: ${err.message}`);
        await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
      }
    } else if (sub === 'remove') {
      try {
        await guildMember.roles.remove(roleId);
        await interaction.reply({ content: `Removed Team Rep role from ${user.tag}.`, ephemeral: true });
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
        await interaction.reply({ content: `Failed to remove role: ${err.message}`, ephemeral: true });
      }
    }
  }
};
