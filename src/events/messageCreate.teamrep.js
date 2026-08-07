const logger = require('../utils/logger');
const { COLORS } = require('../config/theme');
const { EmbedBuilder } = require('discord.js');

function nonNegativeEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const MAX_RETRIES = Math.floor(nonNegativeEnvNumber('TEAM_REP_MAX_RETRIES', 3));
const BACKOFF_BASE_MS = nonNegativeEnvNumber('TEAM_REP_BACKOFF_BASE_MS', 500);
const TEAM_REP_COOLDOWN_MS = nonNegativeEnvNumber('TEAM_REP_COOLDOWN_MS', 60_000);
const TEAM_REP_LOG_COLOR = COLORS.primary;
const requestInProgress = new Set();
const lastRequestAt = new Map();

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

      const httpStatus = err?.status || err?.httpStatus;
      const isPermission = code === 50013 || /missing permissions/i.test(msg);
      const isNotFound = /unknown role|unknown member|unknown user/i.test(msg) || code === 10011;
      const isTransient = /rate limit|retry after|timeout|econnreset|etimedout|network/i.test(msg)
        || httpStatus === 429
        || (typeof httpStatus === 'number' && httpStatus >= 500)
        || (typeof code === 'number' && code >= 500 && code < 600);

      if (isPermission || isNotFound) {
        return { success: false, fatal: true, error: err, attempts: attempt + 1 };
      }

      if (!isTransient || attempt === MAX_RETRIES) {
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

/**
 * Assigns the Team Rep role with retry/backoff.
 * Deliberately takes a guild (not a message) so both the messageCreate flow
 * and the /teamrep slash command share the exact same code path.
 */
async function assignTeamRep(guild, member, roleId) {
  if (!guild) return { success: false, fatal: true, reason: 'no_guild' };

  const targetRole = guild.roles?.cache?.get?.(roleId)
    || (guild.roles?.fetch ? await guild.roles.fetch(roleId).catch(() => null) : null);
  if (!targetRole) return { success: false, fatal: true, reason: 'missing_role' };

  // Bot role hierarchy check
  const botMember = guild.members?.me ?? await guild.members.fetchMe().catch(() => null);
  if (botMember && botMember.roles?.highest && typeof botMember.roles.highest.position === 'number') {
    const botPos = botMember.roles.highest.position;
    const targetPos = targetRole.position ?? 0;
    if (botPos <= targetPos) {
      return { success: false, fatal: true, reason: 'role_hierarchy' };
    }
  }

  return await tryAddRoleWithRetry(member, roleId);
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

      const userId = member.id;
      if (requestInProgress.has(userId)) {
        await message.react('⏳').catch(() => {});
        return;
      }

      const now = Date.now();
      const previousRequest = lastRequestAt.get(userId) ?? 0;
      if (TEAM_REP_COOLDOWN_MS > 0 && now - previousRequest < TEAM_REP_COOLDOWN_MS) {
        await message.react('⏳').catch(() => {});
        return;
      }

      requestInProgress.add(userId);
      lastRequestAt.set(userId, now);
      if (TEAM_REP_COOLDOWN_MS > 0) {
        const cleanup = setTimeout(() => {
          if (lastRequestAt.get(userId) === now) lastRequestAt.delete(userId);
        }, TEAM_REP_COOLDOWN_MS);
        cleanup.unref?.();
      }
      let res;
      try {
        res = await assignTeamRep(message.guild, member, roleId);
      } finally {
        requestInProgress.delete(userId);
      }

      const targetRole = message.guild.roles.cache.get(roleId);

      if (res.success) {
        await message.react('✅').catch(() => {});

        const adminLog = process.env.ADMIN_LOG_CHANNEL;
        if (adminLog) {
          const { sendLog } = require('../handlers/interactions/shared');
          const embed = new EmbedBuilder()
            .setTitle('Team Rep Role Assigned')
            .setColor(TEAM_REP_LOG_COLOR)
            .addFields(
              { name: 'Requester', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
              { name: 'Channel', value: message.channel.toString(), inline: true },
              { name: 'Role', value: targetRole?.name || 'Unknown', inline: true },
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
            .setColor(TEAM_REP_LOG_COLOR)
            .addFields(
              { name: 'Requester', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
              { name: 'Channel', value: message.channel.toString(), inline: true },
              { name: 'Role', value: targetRole?.name || 'Missing', inline: true },
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
          .setColor(TEAM_REP_LOG_COLOR)
          .addFields(
            { name: 'Requester', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
            { name: 'Channel', value: message.channel.toString(), inline: true },
            { name: 'Role', value: targetRole?.name || 'Missing', inline: true },
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
