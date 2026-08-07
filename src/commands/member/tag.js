/**
 * /tag — member-facing clan tag self-service (ported from TagSelector's
 * `/settag`). Admin tag management lives in /tags (commands/admin/tags.js).
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createErrorEmbed } = require('../../utils/embeds');
const { loadTags, resolveTag, searchTags } = require('../../utils/tagStore');
const { applyTag } = require('../../handlers/interactions/tagHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Set or remove your clan tag')
    .addSubcommand(sc => sc.setName('set').setDescription('Put your clan tag in front of your nickname')
      .addStringOption(o => o.setName('tag').setDescription('Your clan tag').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Remove your clan tag from your nickname')),

  /** @param {import('discord.js').AutocompleteInteraction} interaction */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    await interaction.respond(searchTags(focused).map(t => ({ name: t, value: t })));
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member;
    if (!member?.setNickname) {
      return interaction.editReply({ content: 'This command can only be used in a server.' });
    }

    if (interaction.options.getSubcommand() === 'remove') {
      const result = await applyTag(member, null);
      if (!result.ok) {
        return interaction.editReply({ embeds: [createErrorEmbed('Could not remove your tag', result.reason)] });
      }
      if (result.unchanged) {
        return interaction.editReply({ content: 'ℹ️ You do not have a clan tag.' });
      }
      return interaction.editReply({
        content: `🗑️ Tag removed — you are now **${result.nickname}**.${result.roleWarning ? `\n⚠️ ${result.roleWarning}` : ''}`,
      });
    }

    const requested = interaction.options.getString('tag');
    const tag = resolveTag(requested);
    if (!tag) {
      const known = loadTags();
      const available = known.length ? `Available: ${known.map(t => `\`${t}\``).join(', ')}.` : 'No tags are configured yet.';
      return interaction.editReply({
        embeds: [createErrorEmbed('Unknown tag', `\`${requested}\` is not a valid clan tag. ${available}`)],
      });
    }

    const result = await applyTag(member, tag);
    if (!result.ok) {
      return interaction.editReply({ embeds: [createErrorEmbed('Could not set your tag', result.reason)] });
    }
    if (result.unchanged) {
      return interaction.editReply({ content: `ℹ️ Your nickname already carries **[${tag}]**.` });
    }
    return interaction.editReply({
      content: `✅ Tag set — you are now **${result.nickname}**.${result.roleWarning ? `\n⚠️ ${result.roleWarning}` : ''}`,
    });
  }
};
