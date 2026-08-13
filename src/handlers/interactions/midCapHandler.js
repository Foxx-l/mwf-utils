/**
 * midCapHandler.js — Posts the Mid Cap vote as a native Discord poll.
 *
 * The poll follows the map rotation: the match is the next scheduled rotation
 * event and the answers are that map's mid caps. Discord counts the votes and
 * closes the poll at kick-off, so there is nothing to tally or reset here.
 *
 * Who may vote is a channel-permission question, not a bot one: whoever can
 * vote in MIDCAP_CHANNEL votes. The bot needs View Channel, Send Messages and
 * Send Polls there.
 *
 * Polls are immutable once posted — answers can't be edited and a poll can only
 * be ended early. So there is exactly one poll per match, tracked in the store;
 * posting is idempotent, and when a new match's poll goes up the previous one is
 * closed.
 */

const { MessageFlags } = require('discord.js');

const logger = require('../../utils/logger');
const { createErrorEmbed } = require('../../utils/embeds');
const { getMidCaps } = require('../../config/midCaps');
const { currentEvent } = require('../../utils/rotationState');
const { loadRotationState } = require('../../utils/rotationStore');
const { buildPoll, pollDurationHours } = require('../../utils/midCapPoll');
const {
  matchKey,
  loadPoll,
  savePoll,
  markClosed,
  clearPoll,
  listPolls,
} = require('../../utils/midCapStore');

// Discord: 10008 Unknown Message — the poll was deleted, so it may be reposted.
const UNKNOWN_MESSAGE = 10008;

/**
 * @typedef {{ date: string, time: string, map: string, unix: number, live: boolean }} MidCapMatch
 */

/**
 * The match the vote is about, straight from the rotation state.
 *
 * `liveWindowHours` overrides how long a started match still counts as the
 * current one; the post-match scheduler passes 0 so the match that just ended
 * cannot stand in for the next one (see scheduler.js).
 * @param {Date} [now]
 * @param {number} [liveWindowHours]
 */
function getMatch(now = new Date(), liveWindowHours) {
  const channelId = process.env.MAP_ROTATION_CHANNEL;
  if (!channelId) return null;
  return currentEvent(loadRotationState(channelId), now, liveWindowHours);
}

/**
 * What the poll for the current match would look like, or why there isn't one.
 * Flat result (like ensureRotationPosted) rather than a discriminated union, so
 * `@ts-check`ed callers can read `reason` without narrowing gymnastics.
 *
 * @param {Date} [now]
 * @param {{ liveWindowHours?: number }} [opts]
 * @returns {{ ok: boolean, reason?: string, match?: MidCapMatch, caps?: string[],
 *             poll?: import('discord.js').PollData, key?: string }}
 */
function describeMidCapPoll(now = new Date(), { liveWindowHours } = {}) {
  const match = getMatch(now, liveWindowHours);
  if (!match) return { ok: false, reason: 'no upcoming match in the map rotation' };
  if (match.live) return { ok: false, reason: `${match.map} has already started`, match };

  const caps = getMidCaps(match.map);
  if (!caps) return { ok: false, reason: `no mid caps configured for "${match.map}"`, match };

  return { ok: true, match, caps, poll: buildPoll(match, caps, now), key: matchKey(match.date, match.map) };
}

/** Ends every still-open poll from an earlier match. Best effort. */
async function closeEarlierPolls(client, currentKey) {
  for (const [key, pointer] of listPolls()) {
    if (key === currentKey || pointer.closed || !pointer.messageId) continue;
    try {
      const channel = await client.channels.fetch(pointer.channelId);
      const message = await channel.messages.fetch(pointer.messageId);
      if (message.poll && !message.poll.resultsFinalized) await message.poll.end();
      markClosed(key);
      logger.info(`Closed previous mid cap poll for ${key}`);
    } catch (err) {
      // Already ended, deleted, or unreachable — record it either way so we
      // don't retry the same dead pointer every day.
      markClosed(key);
      logger.debug(`Could not end mid cap poll for ${key}: ${err.message}`);
    }
  }
}

/**
 * Posts the poll for the current match unless one is already up.
 *
 * @param {import('discord.js').Client} client
 * @param {{ liveWindowHours?: number }} [opts] forwarded to describeMidCapPoll
 * @returns {Promise<{ ok: boolean, reason?: string, posted?: boolean, messageId?: string, channelId?: string, map?: string }>}
 */
async function ensureMidCapPoll(client, opts = {}) {
  const channelId = process.env.MIDCAP_CHANNEL;
  if (!channelId) return { ok: false, reason: 'MIDCAP_CHANNEL not set' };

  const plan = describeMidCapPoll(new Date(), opts);
  if (!plan.ok) return { ok: false, reason: plan.reason };

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: 'Mid Cap channel unreachable' };

  // Already posted? Confirm it still exists before deciding there's nothing to
  // do — a deleted poll should come back.
  const existing = loadPoll(plan.key);
  if (existing?.messageId) {
    const live = await channel.messages.fetch(existing.messageId).catch(err => {
      if (err?.code !== UNKNOWN_MESSAGE) throw err;
      return null;
    });
    if (live) {
      return { ok: true, posted: false, messageId: live.id, channelId, map: plan.match.map };
    }
    clearPoll(plan.key);
    logger.info(`Mid cap poll for ${plan.key} was deleted — reposting`);
  }

  try {
    const message = await channel.send({ poll: plan.poll });
    savePoll(plan.key, { channelId, messageId: message.id, postedAt: Date.now() });
    logger.success(`Posted mid cap poll for ${plan.match.map} (${plan.match.date}), closes in ${plan.poll.duration}h`);
    await closeEarlierPolls(client, plan.key);
    return { ok: true, posted: true, messageId: message.id, channelId, map: plan.match.map };
  } catch (err) {
    logger.warn(`Could not post mid cap poll: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/**
 * Scheduler entry point — never throws.
 * @param {import('discord.js').Client} client
 * @param {{ liveWindowHours?: number }} [opts]
 */
async function refreshMidCapPoll(client, opts = {}) {
  try {
    return await ensureMidCapPoll(client, opts);
  } catch (err) {
    logger.warn(`Mid cap poll refresh failed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/** `/panel` → Post Mid Cap Poll. */
async function handleAdminPostMidCapPoll(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await ensureMidCapPoll(interaction.client);
  if (!result.ok) {
    await interaction.editReply({ embeds: [createErrorEmbed('Mid cap poll not posted', result.reason)] });
    return false; // skip the audit entry — nothing happened
  }

  const plan = describeMidCapPoll();
  const closes = plan.ok ? ` It closes at kick-off (in ~${pollDurationHours(plan.match)}h).` : '';
  await interaction.editReply({
    content: result.posted
      ? `📊 Posted the **${result.map}** mid cap poll in <#${result.channelId}>.${closes}`
      : `ℹ️ The **${result.map}** poll is already up in <#${result.channelId}> — polls can't be edited, so it was left alone.`,
  });
  return result.posted;
}

module.exports = {
  getMatch,
  describeMidCapPoll,
  ensureMidCapPoll,
  refreshMidCapPoll,
  closeEarlierPolls,
  handleAdminPostMidCapPoll,
};
