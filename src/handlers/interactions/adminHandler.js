/**
 * adminHandler.js — Handles admin panel button interactions.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const logger = require('../../utils/logger');
const { createFactionEmbed, createSuccessEmbed, createErrorEmbed } = require('../../utils/embeds');
const { createFactionButtons } = require('../../utils/buttons');
const { sendLog, bulkDeleteFiltered, batchRoleRemove } = require('./shared');
const { getAllFactionRoleIds } = require('../../config/factions');
const { runHealthcheck } = require('../../utils/healthcheck');
const { remainingCooldown, markAdminAction } = require('../../utils/adminCooldown');

/**
 * Enforces a short per-user cooldown on destructive admin actions so an
 * accidental double-click on Confirm cannot trigger the work twice. Returns
 * `true` if the action may proceed (and records the timestamp), or replies
 * ephemerally and returns `false` when the user is still cooling down.
 */
async function _enforceAdminCooldown(interaction, action) {
  const remaining = remainingCooldown(interaction.user.id, action);
  if (remaining > 0) {
    await interaction.reply({
      embeds: [createErrorEmbed('Slow down', `Please wait **${remaining}s** before repeating *${action}*.`)],
      flags: 64,
    });
    return false;
  }
  markAdminAction(interaction.user.id, action);
  return true;
}

// ── Admin: Reset Confirmation ─────────────────────────────────────────────────

async function handleAdminResetConfirm(interaction) {
  const confirmEmbed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚠️ Confirm Role Reset')
    .setDescription('This will remove **all Allies and Axis roles** from every member.\n\nAre you sure?');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_reset_confirm')
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('admin_reset_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({ embeds: [confirmEmbed], components: [row], flags: 64 });
}

async function handleAdminResetCancel(interaction) {
  return interaction.update({
    embeds: [createErrorEmbed('Cancelled', 'Role reset was cancelled.')],
    components: []
  });
}

/**
 * Removes faction roles from all members in batches to respect Discord rate limits.
 */
async function handleAdminReset(interaction) {
  if (!(await _enforceAdminCooldown(interaction, 'Reset Roles'))) return false;

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x011327).setDescription('⏳ Resetting faction roles...')],
    components: []
  });

  const factionRoleIds = getAllFactionRoleIds();
  const guild          = interaction.guild;

  let totalCount  = 0;
  let totalErrors = [];

  await guild.members.fetch();

  for (const roleId of factionRoleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    const membersWithRole = [...role.members.values()];
    if (!membersWithRole.length) continue;

    // Use batched removal (5 at a time, 500ms between batches) instead of
    // firing all requests concurrently which hammers Discord's rate limiter.
    const { count, errors } = await batchRoleRemove(membersWithRole, roleId);
    totalCount  += count;
    totalErrors  = totalErrors.concat(errors);
  }

  logger.info(`${interaction.user.tag} reset faction roles — ${totalCount} removal(s), ${totalErrors.length} error(s)`);

  const logEmbed = new EmbedBuilder()
    .setColor(0x011327)
    .setTitle('🔁 Manual Faction Reset')
    .addFields(
      { name: '👤 Admin',         value: `<@${interaction.user.id}>`, inline: true },
      { name: '✅ Roles Removed', value: `${totalCount}`,             inline: true },
      { name: '❌ Errors',        value: `${totalErrors.length}`,     inline: true }
    )
    .setTimestamp();

  await sendLog(interaction.client, logEmbed);

  return interaction.editReply({
    embeds: [createSuccessEmbed('Roles Reset', `Removed **${totalCount}** faction role(s).${totalErrors.length ? `\n⚠️ ${totalErrors.length} error(s) occurred.` : ''}`)],
    components: []
  });
}

// ── Admin: Reload Faction Embed ───────────────────────────────────────────────

/**
 * Deletes ONLY the faction embed (title === 'Choose your side!') from the
 * faction channel, then re-posts a fresh one.
 *
 * Previously this deleted ALL bot embeds in the channel, which could wipe
 * unrelated embeds (server details, lineup, etc.) by mistake.
 */
async function handleAdminReload(interaction) {
  await interaction.deferReply({ flags: 64 });

  const channelId = process.env.FACTION_CHANNEL;
  if (!channelId) {
    return interaction.editReply({ embeds: [createErrorEmbed('Config Error', 'FACTION_CHANNEL is not set.')] });
  }

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return interaction.editReply({ embeds: [createErrorEmbed('Channel Not Found', `Could not find channel <#${channelId}>.`)] });
  }

  // Only remove the faction embed — leave all other bot messages untouched.
  const deleted = await bulkDeleteFiltered(
    channel,
    msg =>
      msg.author.id === interaction.client.user.id &&
      msg.embeds.some(e => e.title === 'Choose your side!')
  );

  await channel.send({ embeds: [createFactionEmbed()], components: [createFactionButtons()] });

  logger.info(`${interaction.user.tag} reloaded faction embed (deleted ${deleted} embed(s))`);

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(0x011327)
    .setTitle('🔄 Embed Reloaded')
    .addFields(
      { name: '👤 Admin',          value: `<@${interaction.user.id}>`, inline: true },
      { name: '📌 Channel',        value: `<#${channelId}>`,           inline: true },
      { name: '🗑️ Embeds Deleted', value: `${deleted}`,               inline: true }
    )
    .setTimestamp()
  );

  return interaction.editReply({
    embeds: [createSuccessEmbed('Embed Reloaded', `Cleared **${deleted}** faction embed(s) and posted a fresh one in <#${channelId}>.`)]
  });
}

// ── Admin: Clear Logs (confirmation flow) ─────────────────────────────────────

async function handleAdminClearLogsConfirm(interaction) {
  const logChannelId = process.env.ADMIN_LOG_CHANNEL;
  const target       = logChannelId ? `<#${logChannelId}>` : 'the log channel';

  const confirmEmbed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚠️ Confirm Log Clear')
    .setDescription(`This will delete **all messages** in ${target}.\n\nAre you sure?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_clearlogs_confirm')
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('admin_clearlogs_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({ embeds: [confirmEmbed], components: [row], flags: 64 });
}

async function handleAdminClearLogsCancel(interaction) {
  return interaction.update({
    embeds: [createErrorEmbed('Cancelled', 'Log clear was cancelled.')],
    components: []
  });
}

async function handleAdminClearLogs(interaction) {
  if (!(await _enforceAdminCooldown(interaction, 'Clear Log Channel'))) return false;

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x011327).setDescription('⏳ Clearing logs...')],
    components: []
  });

  const logChannelId = process.env.ADMIN_LOG_CHANNEL;
  if (!logChannelId) {
    return interaction.editReply({ embeds: [createSuccessEmbed('No Log Channel', 'ADMIN_LOG_CHANNEL is not configured.')] });
  }

  const channel = await interaction.client.channels.fetch(logChannelId).catch(() => null);
  if (!channel) {
    return interaction.editReply({ embeds: [createErrorEmbed('Channel Not Found', `Could not find log channel <#${logChannelId}>.`)] });
  }

  const deleted = await bulkDeleteFiltered(channel, () => true);
  logger.info(`${interaction.user.tag} cleared ${deleted} log message(s)`);

  return interaction.editReply({
    embeds: [createSuccessEmbed('Logs Cleared', `Deleted **${deleted}** message(s) from the log channel.`)]
  });
}

// ── Admin: Healthcheck ────────────────────────────────────────────────────────

async function handleAdminHealthcheck(interaction) {
  // Ack the select-menu interaction with deferUpdate so the panel stays
  // in place; the healthcheck result is sent as an ephemeral follow-up.
  await interaction.deferUpdate();

  const guildId = process.env.GUILD_ID;
  const { passed, total, issues, notes = [] } = await runHealthcheck(interaction.client, guildId);

  const embed = _buildHealthcheckEmbed(passed, total, issues, notes);

  logger.info(`${interaction.user.tag} ran healthcheck — ${passed}/${total} passed, ${issues.length} issue(s), ${notes.length} note(s)`);

  const components = [];
  if (issues.length > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_healthcheck_autofix')
        .setLabel('Try auto-fix')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔧')
    ));
  }

  return interaction.followUp({ embeds: [embed], components, flags: 64 });
}

function _buildHealthcheckEmbed(passed, total, issues, notes) {
  const allGood = issues.length === 0;
  const color   = allGood ? 0x2ecc71 : 0xe67e22;
  const title   = allGood
    ? `✅ Healthcheck — ${passed}/${total} checks passed`
    : `⚠️ Healthcheck — ${passed}/${total} checks passed`;

  const issueLines = issues.slice(0, 20).map(i => {
    const head = `• **${i.label}** — ${i.detail}`;
    return i.hint ? `${head}\n  ↳ ${i.hint}` : head;
  });
  if (issues.length > 20) issueLines.push(`…and ${issues.length - 20} more.`);

  const parts = [];
  if (allGood) parts.push('All systems nominal.');
  else parts.push(issueLines.join('\n'));
  if (notes.length) parts.push(`ℹ️ ${notes.join(' · ')}`);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(parts.join('\n\n') || '—')
    .setTimestamp();
}

// ── Admin: Healthcheck Auto-fix ───────────────────────────────────────────────
// Re-runs the probes and, for each issue kind we know how to help with,
// emits a concrete remediation block. Nothing is changed on Discord — the
// admin still has to follow the instructions — but every step they need is
// spelled out so they don't have to hunt for it.

async function handleAdminHealthcheckAutofix(interaction) {
  await interaction.deferReply({ flags: 64 });

  const guildId = process.env.GUILD_ID;
  const { issues, notes = [] } = await runHealthcheck(interaction.client, guildId);

  if (issues.length === 0) {
    return interaction.editReply({
      embeds: [createSuccessEmbed('Nothing to fix', 'Healthcheck is all green — no action needed.')],
    });
  }

  const byKind = new Map();
  for (const issue of issues) {
    const k = issue.kind || 'other';
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(issue);
  }

  const sections = [];

  if (byKind.has('env')) {
    const keys = byKind.get('env').map(i => i.key).filter(Boolean);
    const uniq = Array.from(new Set(keys));
    sections.push([
      '**Missing env vars**',
      uniq.length
        ? 'Add the following to your `.env` file and restart the bot:'
        : 'Check your `.env` for missing/empty values.',
      uniq.length ? '```' + uniq.map(k => `${k}=`).join('\n') + '```' : null,
      'After editing, redeploy with:',
      '```git pull && docker compose up -d --build```',
    ].filter(Boolean).join('\n'));
  }

  if (byKind.has('channel-perms')) {
    const rows = byKind.get('channel-perms').map(i =>
      `• **${i.channelLabel}** <#${i.channelId}> — ${i.detail}`
    );
    sections.push([
      '**Channel permissions**',
      'In **Server Settings → Channels → [each channel] → Permissions**, grant the bot (or the bot role):',
      '• View Channel · Send Messages · Embed Links',
      '• Manage Messages (only for the Admin Logs channel)',
      '',
      rows.join('\n'),
    ].join('\n'));
  }

  if (byKind.has('channel-invalid')) {
    const rows = byKind.get('channel-invalid').map(i =>
      `• **${i.channelLabel}** (\`${i.envVar}\`) — ${i.detail}`
    );
    sections.push([
      '**Channel IDs don\'t resolve**',
      'Right-click each channel → **Copy Channel ID** and paste it into `.env`. Make sure the bot is in the same server.',
      '',
      rows.join('\n'),
    ].join('\n'));
  }

  if (byKind.has('guild')) {
    sections.push([
      '**Guild unreachable**',
      '• Right-click your server icon → **Copy Server ID** and set `GUILD_ID` in `.env`.',
      '• Make sure the bot is still in the server (re-invite if it was kicked).',
    ].join('\n'));
  }

  if (byKind.has('bot-member')) {
    sections.push([
      '**Bot member unavailable**',
      'Re-invite the bot with the correct OAuth2 URL (scopes: `bot` + `applications.commands`, permissions include Manage Roles + Manage Messages).',
    ].join('\n'));
  }

  if (byKind.has('manage-roles')) {
    sections.push([
      '**Bot lacks Manage Roles**',
      'Go to **Server Settings → Roles → [Bot role]** and enable **Manage Roles**. Without it, faction swaps and Reset Roles will fail.',
    ].join('\n'));
  }

  if (byKind.has('role-missing')) {
    const rows = byKind.get('role-missing').map(i =>
      `• \`${i.envVar}\` currently points to \`${i.roleId}\` (role not found)`
    );
    sections.push([
      '**Faction role(s) not found**',
      'Either the role was deleted or the ID in `.env` is wrong. Create the role in **Server Settings → Roles**, right-click → **Copy Role ID**, and update `.env`.',
      '',
      rows.join('\n'),
    ].join('\n'));
  }

  if (byKind.has('role-hierarchy')) {
    const rows = byKind.get('role-hierarchy').map(i =>
      `• bot role **${i.botRoleName}** is not above **${i.roleName}**`
    );
    sections.push([
      '**Bot role hierarchy**',
      'Discord only lets a bot add/remove roles **below** its own highest role. In **Server Settings → Roles**, drag the bot role above every faction role.',
      '',
      rows.join('\n'),
    ].join('\n'));
  }

  // Anything we didn't know how to auto-suggest
  const handled = new Set([
    'env', 'channel-perms', 'channel-invalid',
    'guild', 'bot-member', 'manage-roles',
    'role-missing', 'role-hierarchy',
  ]);
  const unknown = issues.filter(i => !handled.has(i.kind));
  if (unknown.length) {
    sections.push([
      '**Other issues**',
      unknown.map(i => `• ${i.label} — ${i.detail}${i.hint ? ` (${i.hint})` : ''}`).join('\n'),
    ].join('\n'));
  }

  if (notes.length) {
    sections.push(`ℹ️ ${notes.join(' · ')}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🔧 Auto-fix suggestions')
    .setDescription(sections.join('\n\n').slice(0, 4000))
    .setFooter({ text: 'Re-run Healthcheck after applying fixes to verify.' })
    .setTimestamp();

  logger.info(`${interaction.user.tag} requested healthcheck auto-fix — ${issues.length} issue(s) across ${byKind.size} kind(s)`);

  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  handleAdminResetConfirm,
  handleAdminResetCancel,
  handleAdminReset,
  handleAdminReload,
  handleAdminClearLogsConfirm,
  handleAdminClearLogsCancel,
  handleAdminClearLogs,
  handleAdminHealthcheck,
  handleAdminHealthcheckAutofix,
};
