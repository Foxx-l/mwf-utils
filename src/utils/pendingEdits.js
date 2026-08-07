/**
 * pendingEdits.js — Tiny in-memory TTL store for preview/confirm edit flows.
 *
 * Panel edits (Rotation, Nodes, Server Details, Lineup Caption) route through
 * a preview step before the live Discord message is updated. We stash the
 * parsed payload here, keyed by a short random nonce, and consume it when the
 * admin clicks Apply (or drop it on Cancel / timeout).
 *
 * Store layout (per kind namespace): Map<nonce, { ...entry, expiresAt }>
 * Entries older than TTL_MS are evicted on every read/write.
 *
 * Shared helpers for the preview/apply/cancel Discord plumbing live at the
 * bottom — every edit flow uses the same button styling and ownership/expiry
 * handling, so we only implement it once.
 */

const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const TTL_MS = 10 * 60 * 1000; // 10 min
const stores = new Map(); // kind → Map<nonce, entry>

function _store(kind) {
  let s = stores.get(kind);
  if (!s) { s = new Map(); stores.set(kind, s); }
  return s;
}

function _evictExpired(kind, now = Date.now()) {
  const s = _store(kind);
  for (const [nonce, entry] of s) {
    if (entry.expiresAt <= now) s.delete(nonce);
  }
}

function storePendingEdit(kind, entry) {
  _evictExpired(kind);
  const nonce = crypto.randomBytes(6).toString('hex');
  _store(kind).set(nonce, { ...entry, expiresAt: Date.now() + TTL_MS });
  return nonce;
}

/**
 * Pops an entry out of the store. Returns `null` if expired / already used.
 * Caller is expected to verify ownership (entry.ownerId) and re-insert with
 * `restorePendingEdit` if it needs to bounce back (e.g. wrong owner clicked).
 */
function consumePendingEdit(kind, nonce) {
  _evictExpired(kind);
  const s = _store(kind);
  const entry = s.get(nonce);
  if (!entry) return null;
  s.delete(nonce);
  return entry;
}

function restorePendingEdit(kind, nonce, entry) {
  _store(kind).set(nonce, entry);
}

// ── Shared Discord plumbing ───────────────────────────────────────────────────

/**
 * Builds the standard [Apply] [Cancel] row used under every preview embed.
 * The customIds follow `${kind}_apply:${nonce}` / `${kind}_cancel:${nonce}`.
 */
function buildPreviewButtons(kind, nonce) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${kind}_apply:${nonce}`)
      .setLabel('Apply')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`${kind}_cancel:${nonce}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✖️'),
  );
}

/**
 * Resolves an Apply-button interaction: extracts the nonce, consumes the
 * pending entry, and handles the two failure modes by replying to the user.
 *
 * Returns the pending entry on success, or `null` (after sending the reply)
 * if the preview expired or another admin clicked Apply. In the `null` case
 * the caller should `return false` so `trackAction` skips the audit log.
 *
 * `reopenLabel` is embedded in the "expired" notice (e.g. "Edit Nodes").
 */
async function beginApplyInteraction(interaction, kind, reopenLabel) {
  const nonce = interaction.customId.split(':')[1] || '';
  const pending = consumePendingEdit(kind, nonce);

  if (!pending) {
    await interaction.update({
      content: `⏰ Preview expired or already used. Re-open **${reopenLabel}** to try again.`,
      embeds: [],
      components: [],
    });
    return null;
  }
  if (pending.ownerId !== interaction.user.id) {
    restorePendingEdit(kind, nonce, pending);
    await interaction.reply({
      content: '⛔ Only the admin who started this edit can Apply it.',
      flags: 64,
    });
    return null;
  }
  return pending;
}

/**
 * Complete cancel-button handler: consumes the pending entry, enforces
 * ownership, and updates the ephemeral with `discardedMessage`.
 */
async function handleCancelInteraction(interaction, kind, discardedMessage) {
  const nonce = interaction.customId.split(':')[1] || '';
  const pending = consumePendingEdit(kind, nonce);
  if (pending && pending.ownerId !== interaction.user.id) {
    restorePendingEdit(kind, nonce, pending);
    return interaction.reply({
      content: '⛔ Only the admin who started this edit can cancel it.',
      flags: 64,
    });
  }
  return interaction.update({
    content: discardedMessage,
    embeds: [],
    components: [],
  });
}

module.exports = {
  storePendingEdit,
  consumePendingEdit,
  restorePendingEdit,
  buildPreviewButtons,
  beginApplyInteraction,
  handleCancelInteraction,
};
