// @ts-check
/**
 * shared.js — Shared helpers used across interaction handlers.
 */

const logger = require('../../utils/logger');

// ── Logging ───────────────────────────────────────────────────────────────────

/**
 * Send an embed to the admin log channel (if configured).
 */
async function sendLog(client, embed) {
  const logChannelId = process.env.ADMIN_LOG_CHANNEL;
  if (!logChannelId) return;
  try {
    const channel = await client.channels.fetch(logChannelId);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn(`Could not send log to admin channel: ${err.message}`);
  }
}

// ── Message Fetching ──────────────────────────────────────────────────────────

/**
 * Iterates recent messages in a channel deleting those that match filterFn.
 * Handles Discord's 14-day bulk-delete limit gracefully.
 */
async function bulkDeleteFiltered(channel, filterFn) {
  let deleted = 0;
  let before;
  const bulkDeleteCutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);

  do {
    const fetched = await channel.messages.fetch({ limit: 100, before });
    if (fetched.size === 0) break;
    before = fetched.last()?.id;
    const toDelete = fetched.filter(filterFn);
    const recent = toDelete.filter(message => message.createdTimestamp > bulkDeleteCutoff);
    const old = toDelete.filter(message => message.createdTimestamp <= bulkDeleteCutoff);

    if (recent.size) {
      const result = await channel.bulkDelete(recent, true).catch(() => null);
      deleted += result?.size || 0;
    }
    for (const message of old.values()) {
      const removed = await message.delete().then(() => true).catch(() => false);
      if (removed) deleted++;
    }

    if (fetched.size < 100) break;
  } while (before);

  return deleted;
}

/**
 * Finds the most recent bot message in a channel matching a predicate.
 * @param {number} limit - How many recent messages to search (default 50).
 */
async function findLastBotMessage(channel, predicate, limit = 50) {
  const messages = await channel.messages.fetch({ limit });
  return messages.find(m => m.author.id === channel.client.user.id && predicate(m)) ?? null;
}

// ── Embed identity predicates ─────────────────────────────────────────────────
// What makes a message "the faction embed" or "S2's lineup". Shared so the
// panel probes, the edit flows and the healthcheck all recognise the same
// message; pair them with findLastBotMessage, which already filters by author.

/** 'S1' → 'Server 1' (the label written into the lineup caption). */
function serverLabel(server) {
  return server === 'S1' ? 'Server 1' : 'Server 2';
}

/**
 * Carries one of the bot's embeds with this exact title.
 * @param {string} title
 */
function hasEmbedTitle(title) {
  return message => message.embeds.some(e => e.title === title);
}

/**
 * Is the lineup image embed **for this server** — the image alone is not
 * enough, or S1's message gets recognised as S2's.
 * @param {string} server 'S1' | 'S2'
 */
function hasLineupImageFor(server) {
  const label = `**${serverLabel(server)}**`;
  return message => message.embeds.some(e => e.image && e.description?.includes(label));
}

// ── Role Management ───────────────────────────────────────────────────────────

/**
 * Removes a role from a list of members in batches to avoid hitting Discord's
 * rate limiter when there are many members.
 *
 * @param {import('discord.js').GuildMember[]} members
 * @param {string} roleId
 * @param {number} batchSize - Members per batch (default 5)
 * @param {number} delayMs   - Delay between batches in ms (default 500)
 * @returns {Promise<{ count: number, errors: string[] }>}
 */
async function batchRoleRemove(members, roleId, batchSize = 5, delayMs = 500) {
  let count = 0;
  const errors = [];

  for (let i = 0; i < members.length; i += batchSize) {
    const batch = members.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(m => m.roles.remove(roleId)));
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') count++;
      else errors.push(`${batch[j].user.tag}: ${result.reason?.message}`);
    }
    // Pause between batches (skip delay after the last one)
    if (i + batchSize < members.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { count, errors };
}

module.exports = {
  sendLog,
  bulkDeleteFiltered,
  findLastBotMessage,
  batchRoleRemove,
  serverLabel,
  hasEmbedTitle,
  hasLineupImageFor,
};
