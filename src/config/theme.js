// @ts-check
const COLORS = Object.freeze({
  primary: 0x071321,
  success: 0x2ecc71,
  error: 0xe74c3c,
  // Destructive-confirm red, kept distinct from `error`: this one asks a
  // question, `error` reports something that already went wrong.
  danger: 0xff0000,
  warning: 0xe67e22,
  discord: 0x5865f2,
  allies: 0x3b82f6,
  axis: 0xef4444,
});

/**
 * Status glyphs, so every surface spells the same state the same way.
 * `ok/partial/missing` is the posted-state vocabulary the panel reads in;
 * `idle/deleted` cover the per-item outcomes an action reports back.
 */
const GLYPHS = Object.freeze({
  ok: '🟢',
  partial: '🟡',
  missing: '🔴',
  idle: '⚪',
  deleted: '🗑️',
  warn: '⚠️',
  jump: '↗',
});

/**
 * Tri-state glyph for "posted of total": none, some, all.
 * @param {number} posted
 * @param {number} total
 */
function statusGlyph(posted, total) {
  if (!total || posted <= 0) return GLYPHS.missing;
  return posted >= total ? GLYPHS.ok : GLYPHS.partial;
}

module.exports = { COLORS, GLYPHS, statusGlyph };
