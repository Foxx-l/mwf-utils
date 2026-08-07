// @ts-check
/**
 * messageCreate.teamrep.js — Team Rep REQUEST flow.
 *
 * When a member posts in TEAM_REP_CHANNEL the bot posts an approval card with
 * Approve / Reject buttons — in the ADMIN LOG channel, not the public one —
 * and pings TEAM_REP_PING_ROLE so admins notice. The public request channel
 * only ever shows reactions on the member's message (⏳ → ✅ / ❌ / ℹ️).
 * The decision itself lives in handlers/interactions/teamrepHandler.js.
 */

const logger = require('../utils/logger');
const { COLORS } = require('../config/theme');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

function nonNegativeEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const MAX_RETRIES = Math.floor(nonNegativeEnvNumber('TEAM_REP_MAX_RETRIES', 3));
const BACKOFF_BASE_MS = nonNegativeEnvNumber('TEAM_REP_BACKOFF_BASE_MS', 500);
const TEAM_REP_COOLDOWN_MS = nonNegativeEnvNumber('TEAM_REP_COOLDOWN_MS', 60_000);
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
 * Deliberately takes a guild (not a message) so the approval buttons and the
 * /teamrep slash command share the exact same code path.
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

// ── Request flow ──────────────────────────────────────────────────────────────

/**
 * Finds a still-open approval card for this user among recent messages of
 * the channel the cards live in, so a restarted bot (empty in-memory state)
 * doesn't post a duplicate while one is pending.
 * @param {import('discord.js').TextBasedChannel | null} channel
 * @param {string} userId
 */
async function findPendingRequest(channel, userId) {
  if (!channel) return null;
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  const botId = channel.client?.user?.id;
  return messages.find(m =>
    m.author?.id === botId &&
    m.components?.some(row =>
      row.components?.some(b => typeof b.customId === 'string' && b.customId.startsWith(`teamrep_approve:${userId}:`))
    )
  ) ?? null;
}

/**
 * Posts the approval card — in the admin log channel when configured (the
 * normal case) — and pings the configured role so admins get notified.
 * Falls back to the request channel when no log channel is configured so
 * the feature never silently dies.
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').GuildMember} member
 */
async function postApprovalRequest(message, member) {
  const requestChannel = /** @type {import('discord.js').GuildTextBasedChannel} */ (message.channel);
  const pingRoleId = process.env.TEAM_REP_PING_ROLE;
  const content = pingRoleId ? `<@&${pingRoleId}>` : '';

  const logChannelId = process.env.ADMIN_LOG_CHANNEL;
  const logChannel = logChannelId
    ? /** @type {import('discord.js').GuildTextBasedChannel | null} */ (
        await message.client.channels.fetch(logChannelId).catch(() => null))
    : null;
  const inLog = Boolean(logChannel);
  const channel = logChannel ?? requestChannel;

  const embed = new EmbedBuilder()
    .setTitle('🟡 Team Rep Request')
    .setDescription(
      `${member} (\`${member.user.tag}\`) wants the **Team Rep** role.\n` +
      'Approve or reject below.\n\n' +
      `[Jump to request](https://discord.com/channels/${message.guildId}/${message.channel.id}/${message.id})`
    )
    .setColor(COLORS.warning)
    .setTimestamp();

  // customId carries user + request message + request channel so the buttons
  // work even though the card lives in a different channel.
  const row = /** @type {import('discord.js').ActionRowBuilder<import('discord.js').ButtonBuilder>} */ (
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`teamrep_approve:${member.id}:${message.id}:${message.channel.id}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`teamrep_reject:${member.id}:${message.id}:${message.channel.id}`)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌'),
    )
  );

  await channel.send(inLog
    ? { content, embeds: [embed], components: [row] }
    : { content, embeds: [embed], components: [row], reply: { messageReference: message.id, failIfNotExists: false } });

  await message.react('⏳').catch(() => {});

  logger.info(`teamRep: request card posted (${inLog ? 'log channel' : 'request channel fallback'}) for ${member.user.tag}`);
}

module.exports = {
  name: 'messageCreate',
  /** @param {import('discord.js').Message} message */
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

      // Already a Team Rep — nothing to request.
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

      try {
        // A restart must not duplicate a card that is still pending.
        // Cards live in the log channel (or the request channel as fallback).
        const logChannelId = process.env.ADMIN_LOG_CHANNEL;
        const scanChannel = logChannelId
          ? await message.client.channels.fetch(logChannelId).catch(() => null)
          : null;
        const pending = await findPendingRequest(scanChannel ?? message.channel, userId);
        if (pending) {
          await message.react('⏳').catch(() => {});
          return;
        }
        await postApprovalRequest(message, member);
      } finally {
        requestInProgress.delete(userId);
      }
    } catch (err) {
      logger.warn(`teamRep handler failed: ${err.message}`);
    }
  },
  // Exported for testing and shared with the approval handler / slash command
  assignTeamRep,
  findPendingRequest,
};
