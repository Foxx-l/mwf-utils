// @ts-check
/**
 * teamrepHandler.js — Approve / Reject buttons on Team Rep request embeds.
 *
 * The request itself is created by the messageCreate flow (see
 * events/messageCreate.teamrep.js); this module only resolves the admin's
 * decision. Both buttons are admin-gated by the router.
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { COLORS } = require('../../config/theme');
const { sendLog } = require('./shared');
const { assignTeamRep } = require('../../events/messageCreate.teamrep');

/**
 * @param {string} title
 * @param {string} description
 * @param {number} color
 */
function decisionEmbed(title, description, color = COLORS.warning) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

/** customIds look like `teamrep_approve:<userId>:<originalMessageId>` */
function parseIds(interaction) {
  const [, userId, originalId] = interaction.customId.split(':');
  return { userId, originalId: originalId || null };
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string | null} originalId
 */
async function fetchOriginal(interaction, originalId) {
  if (!originalId) return null;
  return await interaction.channel?.messages?.fetch(originalId).catch(() => null) ?? null;
}

/**
 * The request message carries a ⏳ while it awaits a decision; once one is
 * made (approved, rejected, expired) the hourglass goes.
 * @param {import('discord.js').Message | null} original
 */
async function clearPendingReaction(original) {
  if (!original) return;
  await original.reactions?.resolve('⏳')?.remove().catch(() => {});
}

/** @param {import('discord.js').ButtonInteraction} interaction */
async function handleTeamRepApprove(interaction) {
  const roleId = process.env.TEAM_REP_ROLE_ID;
  if (!roleId) {
    return interaction.followUp({ content: 'TEAM_REP_ROLE_ID is not configured.', flags: MessageFlags.Ephemeral });
  }

  const { userId, originalId } = parseIds(interaction);
  const guild = interaction.guild;
  const original = await fetchOriginal(interaction, originalId);
  const member = await guild.members.fetch(userId).catch(() => null);

  if (!member) {
    await clearPendingReaction(original);
    return interaction.update({
      content: '',
      embeds: [decisionEmbed('⚠️ Request Expired', 'The member could not be found — they may have left the server.')],
      components: [],
    });
  }

  if (member.roles.cache.has(roleId)) {
    await clearPendingReaction(original);
    await original?.react('ℹ️').catch(() => {});
    return interaction.update({
      content: '',
      embeds: [decisionEmbed('✅ Already a Team Rep', `${member} already holds the role.`)],
      components: [],
    });
  }

  const res = await assignTeamRep(guild, member, roleId);
  if (!res.success) {
    // Keep the buttons so another admin can retry after fixing perms/hierarchy.
    logger.warn(`teamRep approve failed for ${member.id}: ${res.reason || res.error?.message}`);
    return interaction.followUp({
      content: `❌ Could not assign the role: ${res.reason || res.error?.message || 'unknown'}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await clearPendingReaction(original);
  await original?.react('✅').catch(() => {});

  sendLog(interaction.client, new EmbedBuilder()
    .setTitle('Team Rep Approved')
    .setColor(COLORS.success)
    .addFields(
      { name: 'Member', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: 'Approved by', value: `<@${interaction.user.id}>`, inline: true },
    )
    .setTimestamp()
  ).catch(() => {});

  return interaction.update({
    content: '',
    embeds: [decisionEmbed('✅ Team Rep Approved', `${member} was granted the role by <@${interaction.user.id}>.`, COLORS.success)],
    components: [],
  });
}

/** @param {import('discord.js').ButtonInteraction} interaction */
async function handleTeamRepReject(interaction) {
  const { userId, originalId } = parseIds(interaction);
  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  const original = await fetchOriginal(interaction, originalId);
  await clearPendingReaction(original);
  await original?.react('❌').catch(() => {});

  sendLog(interaction.client, new EmbedBuilder()
    .setTitle('Team Rep Rejected')
    .setColor(COLORS.error)
    .addFields(
      { name: 'Member', value: member ? `${member.user.tag} (<@${member.id}>)` : `<@${userId}>`, inline: true },
      { name: 'Rejected by', value: `<@${interaction.user.id}>`, inline: true },
    )
    .setTimestamp()
  ).catch(() => {});

  return interaction.update({
    content: '',
    embeds: [decisionEmbed(
      '❌ Team Rep Rejected',
      `The request from ${member ?? `<@${userId}>`} was denied by <@${interaction.user.id}>.`,
      COLORS.error,
    )],
    components: [],
  });
}

module.exports = { handleTeamRepApprove, handleTeamRepReject };
