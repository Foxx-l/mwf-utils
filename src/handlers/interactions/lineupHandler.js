/**
 * lineupHandler.js — Handles lineup caption and server-details edit interactions.
 *
 * Admin panel buttons (Edit Caption / Edit Server) use a local cache
 * to avoid async API calls before showModal() — prevents the 3-second
 * Discord interaction timeout.
 */

const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const logger = require('../../utils/logger');
const { createErrorEmbed, createSuccessEmbed } = require('../../utils/embeds');
const { THUMBNAIL_URL } = require('../../config/constants');
const { sendLog, findLastBotMessage } = require('./shared');
const { saveLineupData, loadLineupData, saveServerData, loadServerData } = require('../../utils/lineupStore');
const {
  storePendingEdit,
  buildPreviewButtons,
  beginApplyInteraction,
  handleCancelInteraction,
} = require('../../utils/pendingEdits');

const CAPTION_KIND = 'lineup_caption';
const SERVER_KIND  = 'lineup_server';

function getServerDefaults(server) {
  if (server === 'S1') {
    return {
      defaultName: process.env.SERVER_S1_NAME     || process.env.SERVER_NAME     || 'HCIA EU 1',
      defaultPass: process.env.SERVER_S1_PASSWORD || process.env.SERVER_PASSWORD || 'MWFTIME'
    };
  }
  if (server === 'S2') {
    return {
      defaultName: process.env.SERVER_S2_NAME     || process.env.SERVER_NAME     || 'HCIA EU 2',
      defaultPass: process.env.SERVER_S2_PASSWORD || process.env.SERVER_PASSWORD || 'MWFTIME'
    };
  }
  return {
    defaultName: process.env.SERVER_NAME     || 'HCIA EU 1',
    defaultPass: process.env.SERVER_PASSWORD || 'MWFTIME'
  };
}

// ── Edit Caption Button (from /lineup ephemeral reply) ────────────────────────

async function handleLineupEditCapButton(interaction) {
  const parts     = interaction.customId.split(':');
  const channelId = parts[1];
  const buttonMessageId = parts[2];
  const server    = parts[3] || null; // S1 | S2 | null (legacy)

  const cached = loadLineupData(channelId, server);
  const messageId = cached?.messageId ?? buttonMessageId;
  let currentCaption = cached?.caption ?? 'Midweek Frontline \u2013 Lineup \u2013 ';

  if (!cached || cached.messageId !== messageId) {
    try {
      const ch  = await interaction.client.channels.fetch(channelId);
      const msg = await ch.messages.fetch(messageId);
      currentCaption = msg.embeds[0]?.description ?? msg.embeds[0]?.footer?.text ?? currentCaption;
      saveLineupData(channelId, messageId, currentCaption, server);
    } catch (_) {}
  }

  const serverSuffix = server ? `:${server}` : '';
  const modal = new ModalBuilder()
    .setCustomId(`lineup_caption:${channelId}:${messageId}${serverSuffix}`)
    .setTitle(server ? `Edit Caption (${server})` : 'Edit Caption');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('caption_text')
        .setLabel('Caption')
        .setStyle(TextInputStyle.Short)
        .setValue(currentCaption)
        .setMaxLength(200)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

// Caption modal submit -> preview; actual edit runs on Apply.
async function handleLineupCaptionSubmit(interaction) {
  const parts      = interaction.customId.split(':');
  const channelId  = parts[1];
  const modalMessageId = parts[2];
  const server     = parts[3] || null; // S1 | S2 | null (legacy)
  const newCaption = interaction.fields.getTextInputValue('caption_text');

  await interaction.deferReply({ flags: 64 });

  let imageUrl = null;
  let messageId = modalMessageId;
  try {
    const ch = await interaction.client.channels.fetch(channelId);
    const cached = loadLineupData(channelId, server);
    messageId = cached?.messageId ?? modalMessageId;
    const oldMsg = await ch.messages.fetch(messageId);
    imageUrl = oldMsg.embeds[0]?.image?.url ?? null;
  } catch (err) {
    logger.warn(`Lineup preview: could not load existing message ${modalMessageId}: ${err.message}`);
  }

  const previewEmbed = new EmbedBuilder()
    .setColor(0x011327)
    .setDescription(newCaption);
  if (imageUrl) previewEmbed.setImage(imageUrl);

  const nonce = storePendingEdit(CAPTION_KIND, {
    channelId,
    messageId,
    server,
    caption: newCaption,
    ownerId: interaction.user.id,
  });

  return interaction.editReply({
    content: '\ud83d\udc40 **Preview** \u2014 check the caption below, then click **Apply** to publish or **Cancel** to discard.',
    embeds: [previewEmbed],
    components: [buildPreviewButtons(CAPTION_KIND, nonce)],
  });
}

async function handleLineupCaptionApplyButton(interaction) {
  const pending = await beginApplyInteraction(interaction, CAPTION_KIND, 'Edit Lineup Caption');
  if (!pending) return false;

  const { channelId, messageId, server, caption: newCaption } = pending;

  await interaction.update({
    content: '\u23f3 Applying caption edit\u2026',
    embeds: [],
    components: [],
  });

  try {
    const ch = await interaction.client.channels.fetch(channelId);
    const oldMsg = await ch.messages.fetch(messageId);
    const old    = oldMsg.embeds[0];
    const imageUrl = old?.image?.url;

    const updated = EmbedBuilder.from(old);
    updated.setDescription(newCaption);
    updated.setFooter(null);

    if (imageUrl) {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Failed to download lineup image: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      updated.setImage('attachment://lineup.png');
      await oldMsg.edit({
        embeds:      [updated],
        files:       [{ attachment: buffer, name: 'lineup.png' }],
        attachments: []
      });
    } else {
      await oldMsg.edit({ embeds: [updated] });
    }

    saveLineupData(channelId, messageId, newCaption, server);

    logger.info(`${interaction.user.tag} updated lineup caption to: ${newCaption}`);
    await interaction.editReply({
      content: `\u2705 Caption updated to: **${newCaption}**`,
      embeds: [],
      components: [],
    });
    return { server };
  } catch (err) {
    logger.error('Failed to edit lineup caption:', err);
    await interaction.editReply({
      content: '\u274c Could not edit the message. It may be too old or I lack permissions.',
      embeds: [],
      components: [],
    });
    return false;
  }
}

async function handleLineupCaptionCancelButton(interaction) {
  return handleCancelInteraction(interaction, CAPTION_KIND, '\u274e Caption edit discarded.');
}

// ── Edit Server Button (from Post Server ephemeral reply) ─────────────────────

async function handleLineupEditServerButton(interaction) {
  const parts     = interaction.customId.split(':');
  const channelId = parts[1];
  const messageId = parts[2];
  const server    = parts[3] || null; // S1 | S2 | null (legacy)

  const { defaultName, defaultPass } = getServerDefaults(server);
  const cached = loadServerData(channelId, server);
  let currentName = cached?.serverName     ?? defaultName;
  let currentPass = cached?.serverPassword ?? defaultPass;

  if (!cached || cached.messageId !== messageId) {
    try {
      const ch     = await interaction.client.channels.fetch(channelId);
      const msg    = await ch.messages.fetch(messageId);
      const fields = msg.embeds[0]?.fields ?? [];
      currentName  = fields.find(f => f.name.includes('Server Name'))?.value ?? currentName;
      currentPass  = fields.find(f => f.name.includes('Password'))?.value   ?? currentPass;
      saveServerData(channelId, messageId, currentName, currentPass, server);
    } catch (_) {}
  }

  const serverSuffix = server ? `:${server}` : '';
  const modal = new ModalBuilder()
    .setCustomId(`lineup_server:${channelId}:${messageId}${serverSuffix}`)
    .setTitle(server ? `Edit Server Details (${server})` : 'Edit Server Details');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('server_name')
        .setLabel('Server Name')
        .setStyle(TextInputStyle.Short)
        .setValue(currentName)
        .setMaxLength(100)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('server_password')
        .setLabel('Password')
        .setStyle(TextInputStyle.Short)
        .setValue(currentPass)
        .setMaxLength(100)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

// ── Server Details Modal Submit ───────────────────────────────────────────────

function buildServerDetailsEmbed(server, name, password) {
  return new EmbedBuilder()
    .setTitle(server ? `Server Details (${server})` : 'Server Details')
    .setColor(0x011327)
    .setThumbnail(THUMBNAIL_URL)
    .addFields(
      { name: '\ud83d\udccc Server Name', value: name,     inline: true },
      { name: '\ud83d\udd12 Password',    value: password, inline: true }
    );
}

// Server Details modal submit -> preview; actual edit runs on Apply.
async function handleServerModalSubmit(interaction) {
  const parts     = interaction.customId.split(':');
  const channelId = parts[1];
  const messageId = parts[2];
  const server    = parts[3] || null; // S1 | S2 | null (legacy)
  const newName   = interaction.fields.getTextInputValue('server_name');
  const newPass   = interaction.fields.getTextInputValue('server_password');

  await interaction.deferReply({ flags: 64 });

  const previewEmbed = buildServerDetailsEmbed(server, newName, newPass);

  const nonce = storePendingEdit(SERVER_KIND, {
    channelId,
    messageId,
    server,
    name: newName,
    password: newPass,
    ownerId: interaction.user.id,
  });

  return interaction.editReply({
    content: '\ud83d\udc40 **Preview** \u2014 check the server details below, then click **Apply** to publish or **Cancel** to discard.',
    embeds: [previewEmbed],
    components: [buildPreviewButtons(SERVER_KIND, nonce)],
  });
}

async function handleServerApplyButton(interaction) {
  const pending = await beginApplyInteraction(interaction, SERVER_KIND, 'Edit Server Details');
  if (!pending) return false;

  const { channelId, messageId, server, name: newName, password: newPass } = pending;
  const updated = buildServerDetailsEmbed(server, newName, newPass);

  await interaction.update({
    content: '\u23f3 Applying server-details edit\u2026',
    embeds: [updated],
    components: [],
  });

  try {
    const ch  = await interaction.client.channels.fetch(channelId);
    const msg = await ch.messages.fetch(messageId);
    await msg.edit({ embeds: [updated] });
    saveServerData(channelId, messageId, newName, newPass, server);

    logger.info(`${interaction.user.tag} updated ${server || 'legacy'} server details: ${newName} / ${newPass}`);
    await interaction.editReply({
      content: `\u2705 Server details updated${server ? ` for **${server}**` : ''}!\n**Server Name:** ${newName}\n**Password:** ${newPass}`,
      embeds: [],
      components: [],
    });
    return { server };
  } catch (err) {
    logger.error('Failed to edit server details:', err);
    await interaction.editReply({
      content: '\u274c Could not edit the message. It may be too old or I lack permissions.',
      embeds: [],
      components: [],
    });
    return false;
  }
}

async function handleServerCancelButton(interaction) {
  return handleCancelInteraction(interaction, SERVER_KIND, '\u274e Server details edit discarded.');
}

// ── Admin: Post Server Details (panel button) ─────────────────────────────────

async function handleAdminPostServer(interaction, serverOverride) {
  await interaction.deferReply({ flags: 64 });

  const server    = serverOverride || interaction.customId.split(':')[1] || null; // S1 | S2 | null
  const channelId = process.env.SERVER_DETAILS_CHANNEL;
  const channel   = channelId
    ? await interaction.client.channels.fetch(channelId).catch(() => null)
    : interaction.channel;

  if (!channel) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Config Error', 'SERVER_DETAILS_CHANNEL not found. Check your .env.')]
    });
  }

  const { defaultName, defaultPass } = getServerDefaults(server);
  const serverName     = defaultName;
  const serverPassword = defaultPass;

  const serverEmbed = new EmbedBuilder()
    .setTitle(server ? `Server Details (${server})` : 'Server Details')
    .setColor(0x011327)
    .setThumbnail(THUMBNAIL_URL)
    .addFields(
      { name: '\ud83d\udccc Server Name', value: serverName,     inline: true },
      { name: '\ud83d\udd12 Password',    value: serverPassword, inline: true }
    );

  const previousData = loadServerData(channel.id, server);
  if (previousData?.messageId) {
    const prevMsg = await channel.messages.fetch(previousData.messageId).catch(() => null);
    if (prevMsg) await prevMsg.delete().catch(() => {});
  }

  const serverMsg = await channel.send({ embeds: [serverEmbed] });

  saveServerData(channel.id, serverMsg.id, serverName, serverPassword, server);

  logger.info(`${interaction.user.tag} posted ${server || 'legacy'} server details to #${channel.name}`);

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(0x011327)
    .setTitle(server ? `\ud83d\udda5\ufe0f Server Details Posted (${server})` : '\ud83d\udda5\ufe0f Server Details Posted')
    .addFields(
      { name: '\ud83d\udc64 Admin',   value: `<@${interaction.user.id}>`, inline: true },
      { name: '\ud83d\udccc Channel', value: `<#${channel.id}>`,          inline: true }
    )
    .setTimestamp()
  );

  const serverSuffix = server ? `:${server}` : '';
  const editBtn = new ButtonBuilder()
    .setCustomId(`lineup_editserver:${channel.id}:${serverMsg.id}${serverSuffix}`)
    .setLabel(server ? `Edit Server Details (${server})` : 'Edit Server Details')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('\u270f\ufe0f');

  return interaction.editReply({
    embeds: [createSuccessEmbed(
      server ? `Server Details Posted (${server})` : 'Server Details Posted',
      `Posted to <#${channel.id}>!`
    )],
    components: [new ActionRowBuilder().addComponents(editBtn)]
  });
}

// ── Admin: Edit Lineup Caption (panel button) ─────────────────────────────────

async function handleAdminEditCaption(interaction, serverOverride) {
  const server    = serverOverride || interaction.customId.split(':')[1] || null; // S1 | S2 | null
  const channelId = process.env.LINEUP_CHANNEL || interaction.channelId;

  const cached = loadLineupData(channelId, server);
  if (cached) {
    const serverSuffix = server ? `:${server}` : '';
    const modal = new ModalBuilder()
      .setCustomId(`lineup_caption:${channelId}:${cached.messageId}${serverSuffix}`)
      .setTitle(server ? `Edit Lineup Caption (${server})` : 'Edit Lineup Caption');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('caption_text')
          .setLabel('Caption')
          .setStyle(TextInputStyle.Short)
          .setValue(cached.caption)
          .setMaxLength(200)
          .setRequired(true)
      )
    );

    return interaction.showModal(modal);
  }

  await interaction.deferReply({ flags: 64 });

  const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!ch) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Config Error', 'LINEUP_CHANNEL not found. Check your .env.')]
    });
  }

  const msg = await findLastBotMessage(ch, m => m.embeds.some(e => e.image));
  if (!msg) {
    return interaction.editReply({
      content: `\u274c No lineup message found${server ? ` for ${server}` : ''}. Post one with \`/lineup\` first.`
    });
  }

  const caption = msg.embeds[0]?.description ?? msg.embeds[0]?.footer?.text ?? 'Midweek Frontline \u2013 Lineup \u2013 ';
  saveLineupData(channelId, msg.id, caption, server);

  await interaction.editReply({
    content: `\u2705 Lineup data loaded${server ? ` for ${server}` : ''}. **Click the button again** to open the editor.`
  });
}

// ── Admin: Edit Server Details (panel button) ─────────────────────────────────

async function handleAdminEditServer(interaction, serverOverride) {
  const server    = serverOverride || interaction.customId.split(':')[1] || null; // S1 | S2 | null
  const channelId = process.env.SERVER_DETAILS_CHANNEL || interaction.channelId;

  const cached = loadServerData(channelId, server);
  if (cached) {
    const serverSuffix = server ? `:${server}` : '';
    const modal = new ModalBuilder()
      .setCustomId(`lineup_server:${channelId}:${cached.messageId}${serverSuffix}`)
      .setTitle(server ? `Edit Server Details (${server})` : 'Edit Server Details');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('server_name')
          .setLabel('Server Name')
          .setStyle(TextInputStyle.Short)
          .setValue(cached.serverName)
          .setMaxLength(100)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('server_password')
          .setLabel('Password')
          .setStyle(TextInputStyle.Short)
          .setValue(cached.serverPassword)
          .setMaxLength(100)
          .setRequired(true)
      )
    );

    return interaction.showModal(modal);
  }

  await interaction.deferReply({ flags: 64 });

  const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!ch) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Config Error', 'SERVER_DETAILS_CHANNEL not found. Check your .env.')]
    });
  }

  const expectedTitle = server ? `Server Details (${server})` : 'Server Details';
  const msg = await findLastBotMessage(ch, m => m.embeds.some(e => e.title === expectedTitle));
  if (!msg) {
    return interaction.editReply({
      content: `\u274c No Server Details message found${server ? ` for ${server}` : ''}. Post one first using **Post Server Details${server ? ` ${server}` : ''}**.`
    });
  }

  const { defaultName, defaultPass } = getServerDefaults(server);
  const fields      = msg.embeds[0]?.fields ?? [];
  const serverName  = fields.find(f => f.name.includes('Server Name'))?.value ?? defaultName;
  const serverPass  = fields.find(f => f.name.includes('Password'))?.value   ?? defaultPass;
  saveServerData(channelId, msg.id, serverName, serverPass, server);

  await interaction.editReply({
    content: `\u2705 Server data loaded${server ? ` for ${server}` : ''}. **Click "Edit Server Details${server ? ` ${server}` : ''}" again** to open the editor.`
  });
}

module.exports = {
  handleLineupEditCapButton,
  handleLineupCaptionSubmit,
  handleLineupCaptionApplyButton,
  handleLineupCaptionCancelButton,
  handleLineupEditServerButton,
  handleServerModalSubmit,
  handleServerApplyButton,
  handleServerCancelButton,
  handleAdminPostServer,
  handleAdminEditCaption,
  handleAdminEditServer
};
