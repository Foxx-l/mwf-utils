// @ts-check
/**
 * render.v1.js — The classic embed panel.
 *
 * Kept as the rollback path for the container layout: one navy embed whose
 * description is the status lines, with the select rows below it. Unset
 * `PANEL_V2` and this is what `/panel` sends again.
 */

const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('../config/theme');
const { buildPanelComponents } = require('./controls');
const { summaryLine, legendLine } = require('./rows');

/**
 * @param {{ rows: Array<{ text: string, states: import('./rows').RowState[] }>, meta: string[], footer: string }} view
 */
function renderPanelV1({ rows, meta, footer }) {
  const lines = [
    summaryLine(rows),
    '',
    ...rows.map(r => r.text),
    ...meta,
    '',
    `_${legendLine()}_`,
  ];

  const embed = new EmbedBuilder()
    .setTitle('⚙️  Admin Panel')
    .setColor(COLORS.primary)
    .setDescription(lines.join('\n'))
    .setFooter({ text: footer });

  // Cast at the boundary: an ActionRowBuilder built without a type argument is
  // ActionRowBuilder<AnyComponentBuilder>, which is wider than the row types
  // discord.js accepts in its own reply options. The rows really are select
  // rows, so this is the single place that says so.
  return /** @type {import('discord.js').InteractionEditReplyOptions} */ ({
    embeds: [embed],
    components: buildPanelComponents(),
  });
}

module.exports = { renderPanelV1 };
