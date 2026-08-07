const { ActionRowBuilder, ButtonBuilder } = require('discord.js');
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

module.exports = { createFactionButtons };
