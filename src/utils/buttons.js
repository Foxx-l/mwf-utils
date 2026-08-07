// @ts-check
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const emojiState = require('./emojiState');
const { FACTIONS } = require('../config/factions');

function resolveEmoji(faction) {
  const customId = emojiState[faction.emoji];
  return customId
    ? { id: customId, name: faction.emoji }
    : { name: faction.fallbackEmoji };
}

function createFactionButtons() {
  const buttons = Object.values(FACTIONS).map(faction =>
    new ButtonBuilder()
      .setCustomId(`faction_${faction.key}`)
      .setLabel(faction.label)
      .setStyle(faction.style)
      .setEmoji(resolveEmoji(faction))
  );

  return new ActionRowBuilder().addComponents(buttons);
}

/**
 * One button per mid cap. The match date rides along in the customId so a
 * click on a stale embed (map already played) can be rejected instead of
 * landing on whatever cap now sits at that index.
 *
 * @param {{ date: string }} match
 * @param {string[]} caps
 */
function createMidCapButtons(match, caps) {
  const buttons = caps.slice(0, 3).map((cap, index) =>
    new ButtonBuilder()
      .setCustomId(`midcap_vote:${match.date}:${index}`)
      .setLabel(cap.slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
  );
  return buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
}

module.exports = { createFactionButtons, createMidCapButtons };
