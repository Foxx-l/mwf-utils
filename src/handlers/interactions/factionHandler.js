/**
 * factionHandler.js — Handles faction button interactions.
 *
 * A user may only hold one faction role at a time across all servers (S1/S2).
 * Selecting a new faction removes any other faction role the user holds.
 */

const { EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { createErrorEmbed } = require('../../utils/embeds');
const { sendLog } = require('./shared');
const { getFaction, getFactionRoleId, getAllFactionRoleIds } = require('../../config/factions');

// Per-user cooldown (anti-spam) on actual faction swaps. Keyed by Discord
// user ID, value is the Unix-ms timestamp of the last successful swap.
// Resets on process restart — fine for this use case.
const lastSwapAtMs = new Map();

// Synchronous guard against two overlapping swap handlers for the same user.
// A double-click on different faction buttons can enter handleFactionSelection
// twice before the first finishes; the cooldown timestamp alone can't stop
// the second call from seeing a stale `lastSwapAtMs`. This Set is checked
// and mutated synchronously, before any `await`, so the second call is
// rejected immediately.
const swapInProgress = new Set();

function cooldownSeconds() {
  const raw = parseInt(process.env.FACTION_SWAP_COOLDOWN_SECONDS ?? '20', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 20;
}

// ── In-process throttle ───────────────────────────────────────────────────────
// When many users click faction buttons at the same moment, firing every
// `roles.remove`+`roles.add` concurrently hammers Discord's rate limiter
// and spikes latency for the whole bot. A small FIFO semaphore caps how
// many swaps execute in parallel; the rest wait their turn. Tuned via
// FACTION_SWAP_CONCURRENCY (default 5).
const pendingQueue = [];
let activeSlots = 0;

function maxConcurrency() {
  const raw = Number.parseInt(process.env.FACTION_SWAP_CONCURRENCY ?? '5', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

function acquireSlot() {
  return new Promise(resolve => {
    if (activeSlots < maxConcurrency()) {
      activeSlots++;
      resolve();
    } else {
      pendingQueue.push(resolve);
    }
  });
}

function releaseSlot() {
  const next = pendingQueue.shift();
  if (next) next();
  else activeSlots = Math.max(0, activeSlots - 1);
}

async function handleFactionSelection(interaction, factionKey) {
  const faction = getFaction(factionKey);
  if (!faction) {
    return interaction.reply({
      embeds: [createErrorEmbed('Unknown Faction', `Unknown faction: \`${factionKey}\`.`)],
      flags: 64
    });
  }

  const selectedRoleId = getFactionRoleId(factionKey);
  if (!selectedRoleId) {
    return interaction.reply({
      embeds: [createErrorEmbed('Config Error', `Faction role is not configured. Ask an admin to set \`${faction.envVar}\`.`)],
      flags: 64
    });
  }

  const member = interaction.member;
  const factionLabel = `${faction.fallbackEmoji} ${faction.label}`;

  if (member.roles.cache.has(selectedRoleId)) {
    return interaction.reply({ content: `⚠️ You are already on **${factionLabel}**!`, flags: 64 });
  }

  // Anti-spam: enforce per-user cooldown between faction swaps. The cooldown
  // only burns when the swap actually succeeds — otherwise a failed Discord
  // API call would lock the user out for the full cooldown for no reason.
  // Concurrent double-clicks are blocked by swapInProgress.
  const cdSec  = cooldownSeconds();
  const userId = interaction.user.id;

  if (cdSec > 0) {
    const last = lastSwapAtMs.get(userId) ?? 0;
    const elapsedSec = Math.floor((Date.now() - last) / 1000);
    if (elapsedSec < cdSec) {
      const waitSec = cdSec - elapsedSec;
      return interaction.reply({
        content: `⏳ Slow down! You can swap factions again in **${waitSec}s**.`,
        flags: 64
      });
    }
  }

  if (swapInProgress.has(userId)) {
    return interaction.reply({
      content: '⏳ A faction swap is already in progress for you. Try again in a moment.',
      flags: 64
    });
  }
  swapInProgress.add(userId);

  // Defer before acquiring a slot: when many users click at once, queued
  // swaps can wait longer than Discord's 3s interaction budget, which would
  // otherwise fail the reply. Both awaits live inside the try/finally so
  // swapInProgress is always cleaned up even if deferReply fails (e.g.
  // expired interaction token, network error) — otherwise the user would
  // be locked out until the bot restarts.
  let slotAcquired = false;
  try {
    await interaction.deferReply({ flags: 64 });
    await acquireSlot();
    slotAcquired = true;

    const otherFactionRoleIds = getAllFactionRoleIds().filter(id => id !== selectedRoleId);
    const rolesToRemove = otherFactionRoleIds.filter(id => member.roles.cache.has(id));
    let switched = false;
    if (rolesToRemove.length) {
      switched = true;
      try {
        await member.roles.remove(rolesToRemove, 'Switching faction');
      } catch (err) {
        logger.warn(`Could not remove previous faction role(s) from ${interaction.user.tag}: ${err.message}`);
        return interaction.editReply({
          embeds: [createErrorEmbed(
            'Could not switch faction',
            'I could not remove your previous faction role. Ask an admin to check my role permissions and role hierarchy, then try again.'
          )],
        });
      }
    }

    await member.roles.add(selectedRoleId);
    // Only burn the cooldown on a successful swap.
    if (cdSec > 0) lastSwapAtMs.set(userId, Date.now());
    logger.info(`${interaction.user.tag} joined ${factionLabel}`);

    const logEmbed = new EmbedBuilder()
      .setColor(faction.color)
      .setTitle(`${factionLabel} — Faction Selected`)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '👤 User',      value: `<@${interaction.user.id}>`, inline: true },
        { name: '🏳️ Faction',  value: factionLabel,                inline: true },
        { name: '🔄 Switched',  value: switched ? 'Yes' : 'No',    inline: true }
      )
      .setTimestamp();

    await sendLog(interaction.client, logEmbed);

    return interaction.editReply({
      content: `✅ You have joined **${factionLabel}**! Good luck on the battlefield!`,
    });
  } finally {
    swapInProgress.delete(userId);
    if (slotAcquired) releaseSlot();
  }
}

module.exports = { handleFactionSelection };
