const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

// Team Rep automation: listens for messages in the TEAM_REP_CHANNEL and assigns
// TEAM_REP_ROLE_ID to the message author. Designed to be lightweight and safe.

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      // Ignore bots and DMs
      if (message.author.bot || !message.guild) return;

      const channelId = process.env.TEAM_REP_CHANNEL;
      const roleId = process.env.TEAM_REP_ROLE_ID;
      if (!channelId || !roleId) return; // feature disabled

      if (String(message.channel.id) !== String(channelId)) return;

      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member) return;

      if (member.roles.cache.has(roleId)) {
        // Already has role — react with info and skip
        await message.react('ℹ️').catch(() => {});
        return;
      }

      await member.roles.add(roleId);
      await message.react('✅').catch(() => {});
      // Log to admin channel if configured
      const adminLog = process.env.ADMIN_LOG_CHANNEL;
      if (adminLog) {
        const sendLog = require('../handlers/interactions/shared').sendLog;
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
          .setTitle('Team Rep Role Assigned')
          .setDescription(`<@${member.id}> was given the Team Rep role.`)
          .setTimestamp();
        sendLog(message.client, embed).catch(() => {});
      }
    } catch (err) {
      logger.warn(`teamRep handler failed: ${err.message}`);
    }
  }
};
