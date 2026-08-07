const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');
const { getAllFactionRoleIds } = require('../config/factions');
const { maybeAutoAdvanceRotation } = require('../handlers/interactions/rotationHandler');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Starts the weekly faction role reset scheduler.
 * Default: every Wednesday at 22:00 Europe/Warsaw.
 * Configurable via RESET_DAY (0=Sun, 3=Wed) and RESET_HOUR in .env
 */
function startScheduler(client) {
  const day  = process.env.RESET_DAY  ?? '3';   // 3 = Wednesday
  const hour = process.env.RESET_HOUR ?? '22';  // 22:00

  const expression = `0 ${hour} * * ${day}`;

  if (!cron.validate(expression)) {
    logger.error(`Invalid cron expression: ${expression}. Scheduler not started.`);
    return;
  }

  const dayName = DAY_NAMES[parseInt(day)] ?? `day ${day}`;

  cron.schedule(expression, () => resetFactionRoles(client), {
    timezone: 'Europe/Warsaw'
  });

  logger.info(`Scheduler started — auto-reset every ${dayName} at ${hour}:00 Warsaw time`);
}

/**
 * Starts the daily rotation auto-advance check.
 * Runs every day at 00:30 Europe/Warsaw. When month1 of the rotation embed
 * is entirely in the past, the rolling window advances by one month.
 */
function startRotationScheduler(client) {
  const expression = '30 0 * * *'; // 00:30 daily
  if (!cron.validate(expression)) {
    logger.error(`Invalid rotation cron expression: ${expression}. Rotation scheduler not started.`);
    return;
  }

  cron.schedule(expression, async () => {
    try {
      const result = await maybeAutoAdvanceRotation(client);
      if (result?.skipped) {
        logger.info(`Rotation auto-advance skipped — ${result.skipped}`);
      }
    } catch (err) {
      logger.error(`Rotation auto-advance failed: ${err.message}`);
    }
  }, { timezone: 'Europe/Warsaw' });

  logger.info('Rotation scheduler started — daily check at 00:30 Warsaw time');
}

async function resetFactionRoles(client) {
  logger.info('Running scheduled faction role reset...');

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) {
    logger.error('Scheduler: guild not found.');
    return;
  }

  const factionRoleIds = getAllFactionRoleIds();
  const factionRoles = factionRoleIds
    .map(id => guild.roles.cache.get(id))
    .filter(Boolean);

  if (!factionRoles.length) {
    logger.error('Scheduler: no faction roles found. Check ALLIES_ROLE / AXIS_ROLE / ALLIES_S2_ROLE / AXIS_S2_ROLE in .env');
    return;
  }

  let removed = 0;
  let failed  = 0;

  // Fetch all members to populate the cache so role.members is accurate
  try {
    await guild.members.fetch();
  } catch (err) {
    logger.error('Scheduler: failed to fetch members:', err);
    return;
  }

  // Only iterate members that actually have a faction role — skip everyone else
  const membersToReset = new Map(
    factionRoles.flatMap(role => [...role.members])
  );

  if (!membersToReset.size) {
    logger.info('Scheduler: no members with faction roles — nothing to reset.');
  }

  for (const [, member] of membersToReset) {
    try {
      const rolesToRemove = factionRoles.filter(r => member.roles.cache.has(r.id));
      if (!rolesToRemove.length) continue;
      await member.roles.remove(rolesToRemove, 'Weekly faction reset');
      removed++;
    } catch (err) {
      logger.warn(`Scheduler: failed to remove roles from ${member.user.tag}: ${err.message}`);
      failed++;
    }
  }

  logger.success(`Scheduled reset done — removed roles from ${removed} member(s), ${failed} failed.`);

  // Log to admin channel
  if (process.env.ADMIN_LOG_CHANNEL) {
    try {
      const channel = await client.channels.fetch(process.env.ADMIN_LOG_CHANNEL);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🔄 Weekly Faction Reset')
          .setColor(0x011327)
          .setDescription('Scheduled weekly role reset has been executed.')
          .addFields(
            { name: '✅ Roles Removed', value: `${removed} member(s)`, inline: true },
            { name: '❌ Failed',         value: `${failed} member(s)`,  inline: true }
          )
          .setTimestamp();
        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      logger.warn(`Scheduler: could not log to admin channel: ${err.message}`);
    }
  }
}

module.exports = { startScheduler, startRotationScheduler };
