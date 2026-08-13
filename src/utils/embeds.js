// @ts-check
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { THUMBNAIL_URL, EMBED_TITLES } = require('../config/constants');
const { COLORS } = require('../config/theme');

function createFactionEmbed() {
  return new EmbedBuilder()
    .setTitle(EMBED_TITLES.faction)
    .setDescription("Choose the side you'll be playing on by clicking one of the buttons below. After selecting a side, you'll gain access to the channels where the SL briefings will take place. Good luck, and see you on the server!")
    .setColor(COLORS.primary)
    .setThumbnail(THUMBNAIL_URL);
}

/**
 * Public "how do I get my clan tag" embed, posted with `/tags post`.
 * @param {string[]} tags - the currently available tags
 */
function createTagInfoEmbed(tags) {
  const list = tags.length
    ? tags.map(t => `\`[${t}]\``).join(' · ')
    : '_No tags configured yet._';

  return new EmbedBuilder()
    .setTitle('🏷️ Clan Tags')
    .setDescription(
      'Use **`/tag set`** to put your clan tag in front of your nickname, like `[TAG] Name`.\n' +
      'The tag field autocompletes — pick your clan from the list.\n\n' +
      'Use **`/tag remove`** to drop it again. You can switch or remove your tag at any time.\n' +
      "Please don't use the tag of a clan you aren't a member of."
    )
    .addFields({ name: 'Available tags', value: list })
    .setColor(COLORS.primary)
    .setThumbnail(THUMBNAIL_URL);
}

function createSuccessEmbed(title, description) {
  // Same dark navy as every other embed — the ✅ in the title carries the
  // status, not the stripe color.
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(COLORS.primary)
    .setTimestamp();
}

function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(COLORS.error)
    .setTimestamp();
}

/**
 * The Server Details embed. One builder for the three paths that publish it:
 * `/panel` → Post, the edit preview/apply, and Post All Missing.
 * @param {string|null} server 'S1' | 'S2' | null (legacy single-server)
 * @param {string} name
 * @param {string} password
 */
function createServerDetailsEmbed(server, name, password) {
  return new EmbedBuilder()
    .setTitle(EMBED_TITLES.serverDetails(server))
    .setColor(COLORS.primary)
    .setThumbnail(THUMBNAIL_URL)
    .addFields(
      { name: '📌 Server Name', value: name,     inline: true },
      { name: '🔒 Password',    value: password, inline: true }
    );
}

/**
 * The Confirm/Cancel dialog every destructive admin action opens. Returns the
 * payload rather than sending it, so the caller keeps control of whether it is
 * an ephemeral `reply` or an in-place `update`.
 * @param {{ title: string, description: string, confirmId: string, cancelId: string,
 *           confirmLabel?: string, cancelLabel?: string, color?: number }} opts
 */
function confirmDialog({
  title,
  description,
  confirmId,
  cancelId,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  color = COLORS.danger,
}) {
  return {
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`⚠️ ${title}`)
      .setDescription(description)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel(cancelLabel).setStyle(ButtonStyle.Secondary)
    )],
  };
}

module.exports = {
  createFactionEmbed,
  createTagInfoEmbed,
  createSuccessEmbed,
  createErrorEmbed,
  createServerDetailsEmbed,
  confirmDialog,
};
