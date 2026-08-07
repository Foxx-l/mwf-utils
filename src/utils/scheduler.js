const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');
const { COLORS } = require('../config/theme');
const { getAllFactionRoleIds } = require('../config/factions');
const { maybeAutoAdvanceRotation } = require('../handlers/interactions/rotationHandler');
const { warsawDateParts, warsawToUnix } = require('./warsawTime');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parses RESET_DAY (0=Sun … 6=Sat, default 3) and RESET_HOUR (default 22)
 * from .env. Returns `{ day, hour }`, or `null` when the config is invalid.
 * Single source of truth — the cron scheduler and the panel's "next reset"
 * display both read from here so they can never drift apart.
 */
function getResetSchedule() {
  const day  = Number.parseInt(process.env.RESET_DAY  ?? '3', 10);
  const hour = Number.parseInt(process.env.RESET_HOUR ?? '22', 10);
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { day, hour };
}

/**
 * Unix seconds of the next scheduled reset strictly after `now`, evaluated
 * on the Europe/Warsaw clock. Returns `null` when the schedule is invalid.
 */
function getNextResetTime(now = new Date()) {
  const schedule = getResetSchedule();
  if (!schedule) return null;

  const parts = warsawDateParts(now);
  let daysAhead = (schedule.day - parts.weekday + 7) % 7;
  const nowMinutes = parts.hour * 60 + parts.minute;
  const resetMinutes = schedule.hour * 60;
  // Exactly at reset time we still point at "today" (it is firing now);
  // any time past it rolls to the next matching weekday.
  if (daysAhead === 0 && nowMinutes > resetMinutes) daysAhead = 7;

  // Date.UTC normalizes day overflow (e.g. day 32 -> next month) for us.
  const target = new Date(Date.UTC(parts.year, parts.month, parts.day + daysAhead));
  const t = warsawDateParts(target);
  return warsawToUnix(t.year, t.month, t.day, schedule.hour, 0);
}

/**
 * Starts the weekly faction role reset scheduler.
 * Default: every Wednesday at 22:00 Europe/Warsaw.
 * Configurable via RESET_DAY (0=Sun, 3=Wed) and RESET_HOUR in .env
 */
function startScheduler(client) {
  const schedule = getResetSchedule();
  if (!schedule) {
    logger.error(`Invalid reset schedule: RESET_DAY=${process.env.RESET_DAY ?? '3'}, RESET_HOUR=${process.env.RESET_HOUR ?? '22'}. Scheduler not started.`);
    return;
  }
  const { day, hour } = schedule;

  const expression = `0 ${hour} * * ${day}`;
  if (!cron.validate(expression)) {
    logger.error(`Invalid cron expression: ${expression}. Scheduler not started.`);
    return;
  }

  const dayName = DAY_NAMES[day];

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
      } else if (result?.ok === false) {
        logger.error(`Rotation auto-advance did not run: ${result.reason || 'unknown reason'}`);
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

  // Fetch roles first — reading guild.roles.cache alone can miss roles on a
  // cold cache, which would silently skip them during the reset.
  let roleCache = guild.roles.cache;
  try {
    roleCache = await guild.roles.fetch();
  } catch (err) {
    logger.warn(`Scheduler: could not refresh role cache, falling back to cached roles: ${err.message}`);
  }

  const factionRoles = factionRoleIds
    .map(id => roleCache.get(id))
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
          .setColor(COLORS.primary)
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

module.exports = { startScheduler, startRotationScheduler, getResetSchedule, getNextResetTime };
