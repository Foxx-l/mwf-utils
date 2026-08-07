const { EmbedBuilder } = require('discord.js');
const { THUMBNAIL_URL } = require('../config/constants');

function createFactionEmbed() {
  return new EmbedBuilder()
    .setTitle('Choose your side!')
    .setDescription("Choose the side you'll be playing on by clicking one of the buttons below. After selecting a side, you'll gain access to the channels where the SL briefings will take place. Good luck, and see you on the server!")
    .setColor(0x011327)
    .setThumbnail(THUMBNAIL_URL);
}

function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(0x2ecc71)
    .setTimestamp();
}

function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xe74c3c)
    .setTimestamp();
}

module.exports = { createFactionEmbed, createSuccessEmbed, createErrorEmbed };
