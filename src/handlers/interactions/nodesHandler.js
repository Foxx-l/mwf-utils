/**
 * nodesHandler.js — Handles NODES embed post and edit interactions.
 */

const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require('discord.js');
const logger = require('../../utils/logger');
const { createErrorEmbed, createSuccessEmbed } = require('../../utils/embeds');
const { THUMBNAIL_URL, DEFAULT_NODES } = require('../../config/constants');
const { sendLog, findLastBotMessage } = require('./shared');
const { saveNodesData, loadNodesData } = require('../../utils/nodesStore');
const {
  storePendingEdit,
  buildPreviewButtons,
  beginApplyInteraction,
  handleCancelInteraction,
} = require('../../utils/pendingEdits');

const PENDING_KIND = 'nodes';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNodesChannelIds() {
  const env = process.env.NODES_CHANNELS || '';
  return env.split(',').map(id => id.trim()).filter(Boolean);
}

function buildNodesEmbed(fields) {
  return new EmbedBuilder()
    .setTitle('NODES')
    .setColor(0x011327)
    .setThumbnail(THUMBNAIL_URL)
    .addFields(fields);
}

/**
 * Shows the Edit Nodes modal pre-populated with the given field values.
 */
function showNodesModal(interaction, fields) {
  const getValue = (index) => fields[index]?.value ?? '';

  const modal = new ModalBuilder()
    .setCustomId('nodes_edit')
    .setTitle('Edit Nodes');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nodes_nw')
        .setLabel('North / West HQ')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(getValue(0))
        .setMaxLength(500)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nodes_mid')
        .setLabel('Mid HQ')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(getValue(1))
        .setMaxLength(500)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nodes_se')
        .setLabel('South / East HQ')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(getValue(2))
        .setMaxLength(500)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nodes_arty')
        .setLabel('Arty')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(getValue(3))
        .setMaxLength(500)
        .setRequired(true)
    )
  );

  return interaction.showModal(modal);
}

// ── Nodes Modal Submit ────────────────────────────────────────────────────────

// Modal submit does NOT save directly. Instead, the parsed payload is stashed
// in-memory keyed by a nonce and an ephemeral preview embed + Apply / Cancel
// buttons is shown. The actual message edits run only when Apply is clicked.

async function handleNodesModalSubmit(interaction) {
  await interaction.deferReply({ flags: 64 });

  const fields = [
    { name: 'North / West HQ', value: interaction.fields.getTextInputValue('nodes_nw')   || '—' },
    { name: 'Mid HQ',          value: interaction.fields.getTextInputValue('nodes_mid')  || '—' },
    { name: 'South / East HQ', value: interaction.fields.getTextInputValue('nodes_se')   || '—' },
    { name: 'Arty',            value: interaction.fields.getTextInputValue('nodes_arty') || '—' }
  ];

  const previewEmbed = buildNodesEmbed(fields);

  const nonce = storePendingEdit(PENDING_KIND, {
    fields,
    ownerId: interaction.user.id,
  });

  return interaction.editReply({
    content: '👀 **Preview** — check the node details below, then click **Apply** to publish or **Cancel** to discard.',
    embeds: [previewEmbed],
    components: [buildPreviewButtons(PENDING_KIND, nonce)],
  });
}

async function handleNodesApplyButton(interaction) {
  const pending = await beginApplyInteraction(interaction, PENDING_KIND, 'Edit Nodes');
  if (!pending) return false;

  const { fields } = pending;
  const updatedEmbed = buildNodesEmbed(fields);
  const channelIds   = getNodesChannelIds();

  await interaction.update({
    content: '⏳ Applying node edits…',
    embeds: [updatedEmbed],
    components: [],
  });

  if (!channelIds.length) {
    await interaction.editReply({
      content: '',
      embeds: [createErrorEmbed('Config Error', 'NODES_CHANNELS is not set in .env.')],
      components: [],
    });
    return false;
  }

  saveNodesData(fields);

  let edited = 0;
  let failed = 0;
  for (const channelId of channelIds) {
    try {
      const ch  = await interaction.client.channels.fetch(channelId);
      const msg = await findLastBotMessage(ch, m => m.embeds.some(e => e.title === 'NODES'));
      if (msg) {
        await msg.edit({ embeds: [updatedEmbed] });
        edited++;
      } else {
        failed++;
        logger.warn(`No NODES message found in channel ${channelId}`);
      }
    } catch (err) {
      failed++;
      logger.error(`Failed to edit NODES in channel ${channelId}: ${err.message}`);
    }
  }

  logger.info(`${interaction.user.tag} edited NODES embed — ${edited} updated, ${failed} failed`);

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(0x011327)
    .setTitle('📍 Nodes Embed Edited')
    .addFields(
      { name: '👤 Admin',   value: `<@${interaction.user.id}>`, inline: true },
      { name: '✅ Updated', value: `${edited}`,                  inline: true },
      { name: '❌ Failed',  value: `${failed}`,                  inline: true }
    )
    .setTimestamp()
  );

  return interaction.editReply({
    content: '',
    embeds: [createSuccessEmbed('Nodes Updated', `Updated **${edited}** message(s).${failed ? `\n⚠️ ${failed} channel(s) had no existing NODES message.` : ''}`)],
    components: [],
  });
}

async function handleNodesCancelButton(interaction) {
  return handleCancelInteraction(interaction, PENDING_KIND, '❎ Nodes edit discarded.');
}

// ── Admin: Post Nodes (panel button) ─────────────────────────────────────────

async function handleAdminPostNodes(interaction) {
  await interaction.deferReply({ flags: 64 });

  const channelIds = getNodesChannelIds();

  if (!channelIds.length) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Config Error', 'NODES_CHANNELS is not set in .env.')]
    });
  }

  const nodesEmbed     = buildNodesEmbed(DEFAULT_NODES);
  let posted           = 0;
  let failed           = 0;
  const postedChannels = [];

  saveNodesData(DEFAULT_NODES);

  for (const channelId of channelIds) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      await ch.send({ embeds: [nodesEmbed] });
      postedChannels.push(`<#${channelId}>`);
      posted++;
    } catch (err) {
      failed++;
      logger.error(`Failed to post NODES to channel ${channelId}: ${err.message}`);
    }
  }

  logger.info(`${interaction.user.tag} posted NODES embed to ${posted} channel(s)`);

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(0x011327)
    .setTitle('📍 Nodes Embed Posted')
    .addFields(
      { name: '👤 Admin',    value: `<@${interaction.user.id}>`,        inline: true },
      { name: '📌 Channels', value: postedChannels.join(', ') || '—',  inline: true },
      { name: '❌ Failed',   value: `${failed}`,                         inline: true }
    )
    .setTimestamp()
  );

  return interaction.editReply({
    embeds: [createSuccessEmbed(
      'Nodes Posted',
      `Posted to ${postedChannels.join(', ')}.${failed ? `\n⚠️ Failed to post to ${failed} channel(s).` : ''}`
    )]
  });
}

// ── Admin: Edit Nodes (panel button) ─────────────────────────────────────────

async function handleAdminEditNodes(interaction) {
  const channelIds = getNodesChannelIds();

  if (!channelIds.length) {
    return interaction.reply({
      embeds: [createErrorEmbed('Config Error', 'NODES_CHANNELS is not set in .env.')],
      flags: 64
    });
  }

  const cachedFields = loadNodesData();
  if (cachedFields) {
    return showNodesModal(interaction, cachedFields);
  }

  await interaction.deferReply({ flags: 64 });

  let recoveredFields = null;
  for (const channelId of channelIds) {
    try {
      const ch  = await interaction.client.channels.fetch(channelId);
      const msg = await findLastBotMessage(ch, m => m.embeds.some(e => e.title === 'NODES'));
      if (msg?.embeds[0]?.fields?.length) {
        recoveredFields = msg.embeds[0].fields.map(f => ({ name: f.name, value: f.value }));
        saveNodesData(recoveredFields);
        break;
      }
    } catch (_) {}
  }

  if (!recoveredFields) {
    return interaction.editReply({
      content: '❌ No NODES message found. Post one first using **Post Nodes**.'
    });
  }

  return interaction.editReply({
    embeds: [createSuccessEmbed('Ready', 'Data recovered! Please click **Edit Nodes** again to open the editor.')]
  });
}

module.exports = {
  handleNodesModalSubmit,
  handleNodesApplyButton,
  handleNodesCancelButton,
  handleAdminPostNodes,
  handleAdminEditNodes,
};
