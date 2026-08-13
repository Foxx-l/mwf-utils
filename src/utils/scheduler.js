// @ts-check
/**
 * scheduler.js — Every cron job the bot runs, on the Europe/Warsaw clock.
 *
 * Whatever follows the match schedule runs in the **post-match slot**: RESET_DAY
 * at RESET_HOUR (default Wednesday 22:00), two hours after the 20:00 kick-off, so
 * the match is over. The faction reset clears that week's roles, and the mid cap
 * poll and the per-clan signups publish for the *next* match while everyone is
 * still around. RESET_HOUR is the single knob for all three.
 *
 * The rotation auto-advance is the exception: it tracks calendar months rather
 * than matches, so it keeps its own early-morning time.
 */
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');
const { COLORS } = require('../config/theme');
const { getAllFactionRoleIds } = require('../config/factions');
const { maybeAutoAdvanceRotation } = require('../handlers/interactions/rotationHandler');
const { refreshMidCapPoll } = require('../handlers/interactions/midCapHandler');
const { autoPostSignups } = require('../handlers/interactions/signupHandler');
const { TIME_ZONE, warsawDateParts, warsawToUnix } = require('./warsawTime');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Match day and the hour the match is over: kick-off is 20:00 (see
// ROTATION_EVENT_TIME), so 22:00 is the post-match slot.
const DEFAULT_RESET_DAY  = 3;  // Wednesday
const DEFAULT_RESET_HOUR = 22;

/**
 * Minutes past the post-match hour per job. The reset runs on the dot; the jobs
 * that publish for the *next* match follow a few minutes later so the reset's
 * long role-removal loop is not competing with them for API budget.
 */
const POST_MATCH_MINUTES = Object.freeze({ reset: 0, midCap: 5, signups: 10 });

/**
 * For the post-match jobs, any match that has kicked off counts as played — the
 * poll they post is the next match's, not the one that just ended. (The
 * rotation's own live window deliberately keeps a finished match "current" for
 * hours, which is right for the panel display but wrong here.)
 */
const POST_MATCH_LIVE_WINDOW_HOURS = 0;

/**
 * Parses RESET_DAY (0=Sun … 6=Sat, default 3) and RESET_HOUR (default 22)
 * from .env. Returns `{ day, hour }`, or `null` when the config is invalid.
 * Single source of truth — the cron scheduler and the panel's "next reset"
 * display both read from here so they can never drift apart.
 */
function getResetSchedule() {
  const day  = Number.parseInt(process.env.RESET_DAY  ?? String(DEFAULT_RESET_DAY), 10);
  const hour = Number.parseInt(process.env.RESET_HOUR ?? String(DEFAULT_RESET_HOUR), 10);
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { day, hour };
}

/**
 * The hour of the post-match slot: RESET_HOUR, shared by every match-driven job
 * so they move together when the match time changes. Falls back to the default
 * when RESET_HOUR is unusable — a typo there must not silently un-schedule the
 * poll and the signups, and `startScheduler` already reports the bad value.
 */
function postMatchHour() {
  return getResetSchedule()?.hour ?? DEFAULT_RESET_HOUR;
}

/**
 * Cron expression for a post-match job: `minute` past the post-match hour on
 * `day`. `'*'` (the default) runs it every day — the publish-if-missing jobs use
 * that so a slot missed to downtime is picked up at the same sane hour instead
 * of waiting a full week.
 * @param {number} minute
 * @param {number|'*'} [day]
 */
function postMatchCron(minute, day = '*') {
  return `${minute} ${postMatchHour()} * * ${day}`;
}

/** Warsaw `HH:MM` a post-match job fires at, for the startup log lines. */
function postMatchTimeLabel(minute) {
  return `${postMatchHour()}:${String(minute).padStart(2, '0')}`;
}

/**
 * Registers one Warsaw-time cron job. Returns false (having logged why) when the
 * expression is unusable, so callers can skip their "started" line.
 * @param {string} label
 * @param {string} expression
 * @param {() => void|Promise<void>} task
 */
function startCron(label, expression, task) {
  if (!cron.validate(expression)) {
    logger.error(`Invalid ${label} cron expression: ${expression}. ${label} scheduler not started.`);
    return false;
  }
  cron.schedule(expression, task, { timezone: TIME_ZONE });
  return true;
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
 * Starts the weekly faction role reset — the first job of the post-match slot.
 * Default: every Wednesday at 22:00 Europe/Warsaw, once the match has been
 * played. Configurable via RESET_DAY (0=Sun, 3=Wed) and RESET_HOUR in .env.
 */
function startScheduler(client) {
  const schedule = getResetSchedule();
  if (!schedule) {
    logger.error(`Invalid reset schedule: RESET_DAY=${process.env.RESET_DAY ?? String(DEFAULT_RESET_DAY)}, RESET_HOUR=${process.env.RESET_HOUR ?? String(DEFAULT_RESET_HOUR)}. Scheduler not started.`);
    return;
  }
  const { day, hour } = schedule;

  const expression = postMatchCron(POST_MATCH_MINUTES.reset, day);
  if (!startCron('reset', expression, () => resetFactionRoles(client))) return;

  logger.info(`Scheduler started — auto-reset every ${DAY_NAMES[day]} at ${hour}:00 Warsaw time`);
}

/**
 * Starts the daily rotation auto-advance check.
 *
 * The only job that is *not* tied to the post-match slot: it tracks calendar
 * months, not matches, so it keeps running early each day and the window is
 * already rolled over by the time anything reads it. When month1 of the
 * rotation embed is entirely in the past, the window advances by one month.
 */
function startRotationScheduler(client) {
  const expression = '30 0 * * *'; // 00:30 daily
  const task = async () => {
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
  };
  if (!startCron('rotation', expression, task)) return;

  logger.info('Rotation scheduler started — daily check at 00:30 Warsaw time');
}

/**
 * Posts the Mid Cap poll for the next match.
 *
 * Runs in the post-match slot (default 22:05 Warsaw), so the vote for the next
 * match opens right after the current one has been played rather than in the
 * middle of the night. The check runs every day because posting is idempotent:
 * on a day the poll is already up it does nothing, which is also what puts the
 * poll online when the bot was down during the slot.
 */
function startMidCapScheduler(client) {
  if (!process.env.MIDCAP_CHANNEL) {
    logger.debug('Mid cap scheduler not started — MIDCAP_CHANNEL not set');
    return;
  }

  const expression = postMatchCron(POST_MATCH_MINUTES.midCap);
  const task = async () => {
    const result = await refreshMidCapPoll(client, { liveWindowHours: POST_MATCH_LIVE_WINDOW_HOURS });
    if (!result?.ok) logger.info(`Mid cap poll not posted — ${result?.reason || 'unknown reason'}`);
  };
  if (!startCron('mid cap', expression, task)) return;

  logger.info(`Mid cap scheduler started — poll check daily at ${postMatchTimeLabel(POST_MATCH_MINUTES.midCap)} Warsaw time, after the match`);
}

/**
 * Posts the per-clan RaidHelper signups for the next match day.
 *
 * Runs in the post-match slot (default 22:10 Warsaw), a few minutes behind the
 * reset and the mid cap poll, so next week's signups go up while everyone is
 * still around from the match that just ended. The handler is idempotent per
 * (date, clan) and gated on the store's auto-post switch, so the daily tick is a
 * no-op whenever the events are already up or the feature is paused.
 */
function startSignupScheduler(client) {
  if (!process.env.RAIDHELPER_API_KEY) {
    logger.debug('Signup scheduler not started — RAIDHELPER_API_KEY not set');
    return;
  }

  const expression = postMatchCron(POST_MATCH_MINUTES.signups);
  const task = async () => {
    try {
      const result = await autoPostSignups(client);
      if (result?.skipped) logger.info(`Signup auto-post skipped — ${result.skipped}`);
      else if (result?.ok === false) logger.error(`Signup auto-post did not run: ${result.reason || 'unknown reason'}`);
    } catch (err) {
      logger.error(`Signup auto-post failed: ${err.message}`);
    }
  };
  if (!startCron('signup', expression, task)) return;

  logger.info(`Signup scheduler started — check daily at ${postMatchTimeLabel(POST_MATCH_MINUTES.signups)} Warsaw time, after the match`);
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

module.exports = {
  startScheduler,
  startRotationScheduler,
  startMidCapScheduler,
  startSignupScheduler,
  getResetSchedule,
  getNextResetTime,
  postMatchCron,
  POST_MATCH_MINUTES,
  POST_MATCH_LIVE_WINDOW_HOURS,
};
