const logger = require('../../utils/logger');
const { EmbedBuilder } = require('discord.js');

const MAX_RETRIES = Number(process.env.TEAM_REP_MAX_RETRIES) || 3;
const BACKOFF_BASE_MS = Number(process.env.TEAM_REP_BACKOFF_BASE_MS) || 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryAddRoleWithRetry(member, roleId) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await member.roles.add(roleId);
      return { success: true, attempts: attempt + 1 };
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const code = err?.code || err?.status || err?.httpStatus;

      const isPermission = code === 50013 || /missing permissions/i.test(msg);
      const isNotFound = /unknown role|unknown member|unknown user/i.test(msg) || code === 10011;
      const isRateLimitOrServer = /rate limit|retry after|timeout/i.test(msg) || (typeof code === 'number' && code >= 500);

      if (isPermission || isNotFound) {
        // Fatal: configuration or permission problem — don't retry
        return { success: false, fatal: true, error: err, attempts: attempt + 1 };
      }

      if (attempt === MAX_RETRIES) {
        return { success: false, error: err, attempts: attempt + 1 };
      }

      // Transient: wait and retry
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
      logger.debug(`teamRep: transient error adding role (attempt ${attempt + 1}), retrying in ${delay}ms: ${err.message}`);
      await sleep(delay);
    }
  }
  return { success: false, error: new Error('exhausted retries'), attempts: MAX_RETRIES + 1 };
}

async function assignTeamRep(message, member, roleId) {
  if (!message || !message.guild) return { success: false, fatal: true, reason: 'no_guild' };

  const guild = message.guild;

  const targetRole = guild.roles?.cache?.get ? guild.roles.cache.get(roleId) : null;
  if (!targetRole) return { success: false, fatal: true, reason: 'missing_role' };

  // Bot role hierarchy check
  const botMember = await guild.members.fetch(message.client.user.id).catch(() => null);
  if (botMember && botMember.roles?.highest && typeof botMember.roles.highest.position === 'number') {
    const botPos = botMember.roles.highest.position;
    const targetPos = targetRole.position ?? 0;
    if (botPos <= targetPos) {
      return { success: false, fatal: true, reason: 'role_hierarchy' };
    }
  }

  return await tryAddRoleWithRetry(member, roleId);
}

function formatPriorRoles(member, guild, maxRoles = 10) {
  if (!member || !member.roles || !member.roles.cache) return 'None';
  const roles = member.roles.cache
    .filter(r => r.id !== guild.id) // exclude @everyone
    .map(r => r.name)
    .slice(0, maxRoles);
  if (roles.length === 0) return 'None';
  const joined = roles.join(', ');
  // Truncate to keep embed sizes safe
  if (joined.length > 800) return joined.slice(0, 797) + '...';
  return joined;
}

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
        await message.react('ℹ️').catch(() => {});
        return;
      }

      const res = await assignTeamRep(message, member, roleId);

      const targetRole = message.guild.roles.cache.get(roleId);
      const priorRoles = formatPriorRoles(member, message.guild, 10);

      if (res.success) {
        await message.react('✅').catch(() => {});

        const adminLog = process.env.ADMIN_LOG_CHANNEL;
        if (adminLog) {
          const { sendLog } = require('../handlers/interactions/shared');
          const embed = new EmbedBuilder()
            .setTitle('Team Rep Role Assigned')
            .setColor(0x2ecc71)
            .addFields(
              { name: 'Requester', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
              { name: 'Channel', value: `${message.channel.toString()} (${message.channel.id})`, inline: true },
              { name: 'Role', value: `${targetRole ? `${targetRole.name} (${targetRole.id})` : roleId}`, inline: true },
              { name: 'Prior roles', value: priorRoles, inline: false },
            )
            .setTimestamp();
          sendLog(message.client, embed).catch(() => {});
        }
        return;
      }

      // Failure paths
      if (res.fatal) {
        await message.react('❌').catch(() => {});

        // Log a helpful admin message
        const adminLog = process.env.ADMIN_LOG_CHANNEL;
        if (adminLog) {
          const { sendLog } = require('../handlers/interactions/shared');
          const embed = new EmbedBuilder()
            .setTitle('Team Rep Assignment Failed')
            .setColor(0xe74c3c)
            .addFields(
              { name: 'Requester', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
              { name: 'Channel', value: `${message.channel.toString()} (${message.channel.id})`, inline: true },
              { name: 'Role', value: targetRole ? `${targetRole.name} (${targetRole.id})` : 'Missing', inline: true },
              { name: 'Prior roles', value: priorRoles, inline: false },
              { name: 'Reason', value: `${res.reason || res.error?.message || 'unknown'}`, inline: false },
              { name: 'Attempts', value: `${res.attempts || 0}`, inline: true },
            )
            .setTimestamp();
          sendLog(message.client, embed).catch(() => {});
        }
        return;
      }

      // Non-fatal failure after retries
      await message.react('❌').catch(() => {});
      logger.warn(`teamRep: failed to assign role to ${member.id}: ${res.error?.message}`);

      // Optional admin log for non-fatal failures
      const adminLog = process.env.ADMIN_LOG_CHANNEL;
      if (adminLog) {
        const { sendLog } = require('../handlers/interactions/shared');
        const embed = new EmbedBuilder()
          .setTitle('Team Rep Assignment Failed')
          .setColor(0xe74c3c)
          .addFields(
            { name: 'Requester', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
            { name: 'Channel', value: `${message.channel.toString()} (${message.channel.id})`, inline: true },
            { name: 'Role', value: targetRole ? `${targetRole.name} (${targetRole.id})` : 'Missing', inline: true },
            { name: 'Prior roles', value: priorRoles, inline: false },
            { name: 'Error', value: `${res.error?.message || 'unknown'}`.slice(0, 1000), inline: false },
            { name: 'Attempts', value: `${res.attempts || 0}`, inline: true },
          )
          .setTimestamp();
        sendLog(message.client, embed).catch(() => {});
      }

    } catch (err) {
      logger.warn(`teamRep handler failed: ${err.message}`);
    }
  },
  // Exported for testing
  assignTeamRep,
};
