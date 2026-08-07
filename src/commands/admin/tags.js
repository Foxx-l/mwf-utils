/**
 * /tags — admin management of the clan tag list (ported from TagSelector's
 * `/add_tag`, `/remove_tag` and `/post_taginfo`), plus `set`/`clear` so an
 * admin can fix another member's tag.
 *
 * The member-facing half is /tag (commands/member/tag.js).
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const logger = require('../../utils/logger');
const { COLORS } = require('../../config/theme');
const { createErrorEmbed, createTagInfoEmbed } = require('../../utils/embeds');
const { sendLog } = require('../../handlers/interactions/shared');
const { loadTags, resolveTag, searchTags, addTag, removeTag } = require('../../utils/tagStore');
const { applyTag } = require('../../handlers/interactions/tagHandler');

function adminLog(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(COLORS.primary)
    .setTimestamp();
}

/**
 * Deletes the guild role named like `tag`, if there is one.
 * @param {import('discord.js').Guild} guild
 * @param {string} tag
 * @returns {Promise<string>} a sentence to append to the admin's reply
 */
async function deleteTagRole(guild, tag) {
  const role = guild.roles.cache.find(r => r.name.toLowerCase() === tag.toLowerCase());
  if (!role) return ' No matching role existed.';
  try {
    await role.delete(`Clan tag ${tag} removed`);
    return ` Role **${role.name}** deleted.`;
  } catch (err) {
    logger.warn(`Could not delete tag role ${role.name}: ${err.message}`);
    return ` ⚠️ Could not delete the role **${role.name}** (${err.message}).`;
  }
}

/** Where `/tags post` publishes the info embed. */
async function resolvePostChannel(interaction) {
  const configured = process.env.TAG_CHANNEL;
  if (!configured) return interaction.channel;
  const channel = await interaction.client.channels.fetch(configured).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tags')
    .setDescription('Manage the clan tag list')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc.setName('list').setDescription('Show every configured clan tag'))
    .addSubcommand(sc => sc.setName('add').setDescription('Add a clan tag to the list')
      .addStringOption(o => o.setName('tag').setDescription('The tag text, e.g. OKT').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Remove a clan tag from the list')
      .addStringOption(o => o.setName('tag').setDescription('The tag to remove').setRequired(true).setAutocomplete(true))
      .addBooleanOption(o => o.setName('delete_role').setDescription('Also delete the Discord role with that name (default: no)')))
    .addSubcommand(sc => sc.setName('post').setDescription('Post the public "how to use /tag" embed'))
    .addSubcommand(sc => sc.setName('set').setDescription("Set another member's clan tag")
      .addUserOption(o => o.setName('member').setDescription('Member to tag').setRequired(true))
      .addStringOption(o => o.setName('tag').setDescription('The tag to apply').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sc => sc.setName('clear').setDescription("Remove another member's clan tag")
      .addUserOption(o => o.setName('member').setDescription('Member to clear').setRequired(true))),

  /** @param {import('discord.js').AutocompleteInteraction} interaction */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    await interaction.respond(searchTags(focused).map(t => ({ name: t, value: t })));
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const tags = loadTags();
      return interaction.editReply({
        content: tags.length
          ? `🏷️ ${tags.length} clan tag(s): ${tags.map(t => `\`${t}\``).join(', ')}`
          : 'No clan tags are configured. Add one with `/tags add`.',
      });
    }

    if (sub === 'add') {
      const result = addTag(interaction.options.getString('tag'));
      if (!result.ok) {
        return interaction.editReply({ embeds: [createErrorEmbed('Could not add tag', result.reason)] });
      }
      sendLog(interaction.client, adminLog(
        '🏷️ Clan Tag Added',
        `\`${result.tag}\` was added to the tag list by ${interaction.user.tag}`
      )).catch(() => {});
      return interaction.editReply({
        content: `✅ Tag \`${result.tag}\` added. Create a role named exactly \`${result.tag}\` if you want members to get a role with it.`,
      });
    }

    if (sub === 'remove') {
      const result = removeTag(interaction.options.getString('tag'));
      if (!result.ok) {
        return interaction.editReply({ embeds: [createErrorEmbed('Could not remove tag', result.reason)] });
      }
      let roleNote = '';
      if (interaction.options.getBoolean('delete_role') && interaction.guild) {
        roleNote = await deleteTagRole(interaction.guild, result.tag);
      }
      sendLog(interaction.client, adminLog(
        '🏷️ Clan Tag Removed',
        `\`${result.tag}\` was removed from the tag list by ${interaction.user.tag}`
      )).catch(() => {});
      return interaction.editReply({
        content: `🗑️ Tag \`${result.tag}\` removed.${roleNote} Members who already carry it keep their nickname until they run \`/tag remove\`.`,
      });
    }

    if (sub === 'post') {
      const channel = await resolvePostChannel(interaction);
      if (!channel) {
        return interaction.editReply({
          embeds: [createErrorEmbed('Could not post', 'The channel in `TAG_CHANNEL` could not be resolved or is not a text channel.')],
        });
      }
      try {
        const message = await channel.send({ embeds: [createTagInfoEmbed(loadTags())] });
        sendLog(interaction.client, adminLog(
          '🏷️ Clan Tag Info Posted',
          `${interaction.user.tag} posted the clan tag embed in <#${channel.id}>`
        )).catch(() => {});
        return interaction.editReply({ content: `✅ Posted in <#${channel.id}> — ${message.url}` });
      } catch (err) {
        logger.warn(`Could not post tag info embed: ${err.message}`);
        return interaction.editReply({
          embeds: [createErrorEmbed('Could not post', `Discord rejected the message: ${err.message}`)],
        });
      }
    }

    // set / clear — act on another member
    const user = interaction.options.getUser('member');
    const member = await interaction.guild?.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ content: 'Could not find that member in this server.' });
    }

    if (sub === 'clear') {
      const result = await applyTag(member, null, { actorTag: interaction.user.tag });
      if (!result.ok) {
        return interaction.editReply({ embeds: [createErrorEmbed('Could not clear tag', result.reason)] });
      }
      return interaction.editReply({
        content: result.unchanged
          ? `ℹ️ ${user.tag} has no clan tag.`
          : `🗑️ Cleared ${user.tag}'s tag — they are now **${result.nickname}**.${result.roleWarning ? `\n⚠️ ${result.roleWarning}` : ''}`,
      });
    }

    const requested = interaction.options.getString('tag');
    const tag = resolveTag(requested);
    if (!tag) {
      return interaction.editReply({
        embeds: [createErrorEmbed('Unknown tag', `\`${requested}\` is not in the tag list. Add it first with \`/tags add\`.`)],
      });
    }

    const result = await applyTag(member, tag, { actorTag: interaction.user.tag });
    if (!result.ok) {
      return interaction.editReply({ embeds: [createErrorEmbed('Could not set tag', result.reason)] });
    }
    return interaction.editReply({
      content: result.unchanged
        ? `ℹ️ ${user.tag} already carries **[${tag}]**.`
        : `✅ ${user.tag} is now **${result.nickname}**.${result.roleWarning ? `\n⚠️ ${result.roleWarning}` : ''}`,
    });
  }
};
