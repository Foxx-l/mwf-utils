// @ts-check
/**
 * render.v2.js — The panel as a Components V2 container.
 *
 * What the container buys over the embed: each feature row can carry its own
 * one-click button (a Section takes exactly one accessory), and the layout is no
 * longer capped at five component rows — which is the wall that pushed the
 * signups feature into a separate message.
 *
 * The rules, none of which discord.js checks for us:
 *  · the message may carry **no** `embeds` and **no** `content` — everything is
 *    a TextDisplay, and the accent colour replaces the embed's stripe;
 *  · `MessageFlags.IsComponentsV2` must be set on the reply *and on every edit*,
 *    which is why payload.js is the only place that attaches it;
 *  · a Section holds 1–3 TextDisplays and exactly one accessory, Button or
 *    Thumbnail, never both;
 *  · the whole tree is capped at 40 components — see budget.js, which counts
 *    them rather than waiting for Discord's 400.
 */

const {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');

const { COLORS } = require('../config/theme');
const { MENUS_V2, buildPanelComponents, buildUtilityRow, sectionAction, actionButton } = require('./controls');
const { assertBudget } = require('./budget');
const { summaryLine, legendLine } = require('./rows');

/** @param {string} content */
function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

/** @param {'Small'|'Large'} spacing */
function separator(spacing) {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(spacing === 'Large' ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/**
 * One feature row. It becomes a Section when the feature has a one-click action,
 * and a plain line when it doesn't — a Section costs three components for the
 * one button, so rows without an obvious single action (the S1/S2 pairs) stay
 * cheap.
 * @param {{ key: string, text: string }} row
 */
function featureRow(row) {
  const action = sectionAction(row.key);
  if (!action) return { kind: 'text', component: text(row.text) };
  return {
    kind: 'section',
    component: new SectionBuilder()
      .addTextDisplayComponents(text(row.text))
      .setButtonAccessory(actionButton(action)),
  };
}

/**
 * @param {{ rows: Array<{ key: string, text: string, states: import('./rows').RowState[] }>, meta: string[], footer: string }} view
 */
function renderPanelV2({ rows, meta, footer }) {
  const container = new ContainerBuilder().setAccentColor(COLORS.primary);

  container.addTextDisplayComponents(text(`## ⚙️  Admin Panel\n${summaryLine(rows)}`));
  container.addSeparatorComponents(separator('Large'));

  for (const row of rows) {
    const built = featureRow(row);
    if (built.kind === 'section') {
      container.addSectionComponents(/** @type {*} */ (built.component));
    } else {
      container.addTextDisplayComponents(/** @type {*} */ (built.component));
    }
  }

  if (meta.length) container.addTextDisplayComponents(text(meta.join('\n')));

  container.addSeparatorComponents(separator('Small'));
  // `-# ` is Discord's subtext, the closest thing a container has to the embed
  // footer it replaces.
  container.addTextDisplayComponents(text(`-# ${legendLine()}\n-# ${footer}`));

  for (const selectRow of buildPanelComponents(MENUS_V2)) {
    container.addActionRowComponents(/** @type {*} */ (selectRow));
  }
  container.addActionRowComponents(/** @type {*} */ (buildUtilityRow()));

  const components = [container];
  assertBudget(components);
  return { components };
}

module.exports = { renderPanelV2 };
