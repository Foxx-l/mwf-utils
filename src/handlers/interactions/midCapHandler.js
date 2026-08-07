/**
 * midCapHandler.js — Mid Cap vote embed and voting.
 *
 * The poll always follows the map rotation: the match shown is the next
 * scheduled rotation event (or the one in progress), and the three options come
 * from that map's mid caps. Because ballots are keyed by match, the poll resets
 * itself every week without anything having to clear it.
 *
 * Who may vote is decided by faction role: Allies role → Allies vote, Axis role
 * → Axis vote. Members with no faction role (or both) are told to pick a side
 * first. Everyone gets one vote; clicking the same cap again takes it back.
 *
 * The embed is upserted, like the rotation embed: the stored message is edited
 * in place when it still exists, otherwise a fresh one is posted.
 */

const { MessageFlags } = require('discord.js');

const logger = require('../../utils/logger');
const { createErrorEmbed, createMidCapEmbed } = require('../../utils/embeds');
const { createMidCapButtons } = require('../../utils/buttons');
const { findLastBotMessage } = require('./shared');
const { getMidCaps } = require('../../config/midCaps');
const { TEAMS, getMemberTeam } = require('../../config/factions');
const { currentEvent } = require('../../utils/rotationState');
const { loadRotationState } = require('../../utils/rotationStore');
const { tallyVotes } = require('../../utils/midCapVote');
const {
  matchKey,
  loadBallots,
  castVote,
  saveCapMessage,
  loadCapMessage,
} = require('../../utils/midCapStore');

const EMBED_TITLE = '🎯 Mid Cap Vote';

/** The match the vote is currently about, straight from the rotation state. */
function getMatch(now = new Date()) {
  const channelId = process.env.MAP_ROTATION_CHANNEL;
  if (!channelId) return null;
  return currentEvent(loadRotationState(channelId), now);
}

/**
 * Embed + buttons for the current match. Buttons are omitted when there is
 * nothing to vote on, so a stale embed can't collect votes.
 */
function buildMidCapPayload(now = new Date()) {
  const match = getMatch(now);
  const caps = match ? (getMidCaps(match.map) ?? []) : [];
  const ballots = match ? loadBallots(matchKey(match.date, match.map)) : {};
  const tally = tallyVotes(ballots, caps);

  return {
    embeds: [createMidCapEmbed(match, caps, tally)],
    components: match && caps.length ? createMidCapButtons(match, caps) : [],
    match,
    caps,
  };
}

// ── Posting / refreshing ─────────────────────────────────────────────────────

/**
 * Posts the vote embed, or edits the existing one in place.
 * @returns {Promise<{ ok: boolean, reason?: string, messageId?: string, channelId?: string, created?: boolean }>}
 */
async function ensureMidCapPosted(client) {
  const channelId = process.env.MIDCAP_CHANNEL;
  if (!channelId) return { ok: false, reason: 'MIDCAP_CHANNEL not set' };

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: 'Mid Cap channel unreachable' };

  const payload = buildMidCapPayload();
  const message = { embeds: payload.embeds, components: payload.components };

  // Prefer the stored pointer; fall back to scanning the channel so a lost
  // data file doesn't produce a second embed.
  const stored = loadCapMessage();
  let existing = null;
  if (stored?.channelId === channelId && stored?.messageId) {
    existing = await channel.messages.fetch(stored.messageId).catch(() => null);
  }
  if (!existing) {
    existing = await findLastBotMessage(
      channel,
      m => m.embeds.some(e => e.title === EMBED_TITLE),
    ).catch(() => null);
  }

  try {
    if (existing) {
      await existing.edit(message);
      saveCapMessage(channelId, existing.id);
      return { ok: true, messageId: existing.id, channelId, created: false };
    }
    const posted = await channel.send(message);
    saveCapMessage(channelId, posted.id);
    return { ok: true, messageId: posted.id, channelId, created: true };
  } catch (err) {
    logger.warn(`Could not upsert Mid Cap embed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/** Best-effort refresh used by the scheduler; never throws. */
async function refreshMidCapMessage(client) {
  try {
    return await ensureMidCapPosted(client);
  } catch (err) {
    logger.warn(`Mid Cap refresh failed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

// ── Voting ───────────────────────────────────────────────────────────────────

/**
 * Handles a `midcap_vote:<date>:<index>` button click.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} arg the customId payload after the prefix
 */
async function handleMidCapVote(interaction, arg) {
  const [date, rawIndex] = String(arg).split(':');
  const match = getMatch();

  // The embed the member clicked is for a match that has already been played
  // (or the rotation moved). Refresh it rather than recording a stale vote.
  if (!match || match.date !== date) {
    await interaction.reply({
      content: '⌛ That vote was for an earlier match. Refreshing the embed — vote again on the new one.',
      flags: MessageFlags.Ephemeral,
    });
    await refreshMidCapMessage(interaction.client);
    return;
  }

  const caps = getMidCaps(match.map) ?? [];
  const cap = caps[Number(rawIndex)];
  if (!cap) {
    return interaction.reply({
      embeds: [createErrorEmbed('Unknown mid cap', `No mid caps are configured for **${match.map}**.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const team = getMemberTeam(interaction.member);
  if (!team) {
    const where = process.env.FACTION_CHANNEL ? ` in <#${process.env.FACTION_CHANNEL}>` : '';
    return interaction.reply({
      content: `⚠️ Pick your side first${where} — your faction role decides which team your vote counts for.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const result = await castVote(matchKey(match.date, match.map), interaction.user.id, team, cap);
  if (!result.saved) {
    return interaction.reply({
      embeds: [createErrorEmbed('Vote not saved', 'I could not write the vote to disk. Ask an admin to check the data directory.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const teamLabel = `${TEAMS[team].emoji} ${TEAMS[team].label}`;
  const confirmation = {
    added: `✅ Vote counted for **${cap}** (${teamLabel}).`,
    moved: `🔄 Moved your ${teamLabel} vote from **${result.previousCap}** to **${cap}**.`,
    retracted: `↩️ Took back your ${teamLabel} vote for **${cap}**.`,
  }[result.action];

  // Update the embed the member clicked, so the new counts show immediately.
  const payload = buildMidCapPayload();
  try {
    await interaction.update({ embeds: payload.embeds, components: payload.components });
    await interaction.followUp({ content: confirmation, flags: MessageFlags.Ephemeral });
  } catch (err) {
    logger.debug(`Mid Cap embed update failed, falling back to reply: ${err.message}`);
    await interaction.reply({ content: confirmation, flags: MessageFlags.Ephemeral }).catch(() => {});
    await refreshMidCapMessage(interaction.client);
  }

  logger.info(`${interaction.user.tag} ${result.action} mid cap vote — ${match.map} / ${cap} (${team})`);
}

/** `/panel` → Post / Refresh Mid Cap. */
async function handleAdminPostMidCap(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await ensureMidCapPosted(interaction.client);
  if (!result.ok) {
    await interaction.editReply({ embeds: [createErrorEmbed('Mid Cap embed not posted', result.reason)] });
    return false;
  }
  const payload = buildMidCapPayload();
  const what = payload.match ? `**${payload.match.map}**` : 'no scheduled match';
  await interaction.editReply({
    content: `${result.created ? '📤 Posted' : '🔄 Refreshed'} the Mid Cap vote in <#${result.channelId}> — ${what}.`,
  });
  return true;
}

module.exports = {
  EMBED_TITLE,
  getMatch,
  buildMidCapPayload,
  ensureMidCapPosted,
  refreshMidCapMessage,
  handleMidCapVote,
  handleAdminPostMidCap,
};
