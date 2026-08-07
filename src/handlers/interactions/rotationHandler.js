/** Map Rotation interactions backed by canonical, versioned rotation state. */

const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const logger = require('../../utils/logger');
const { COLORS } = require('../../config/theme');
const { createErrorEmbed, createSuccessEmbed } = require('../../utils/embeds');
const { sendLog } = require('./shared');
const { THUMBNAIL_URL } = require('../../config/constants');
const {
  saveRotationMsgId,
  loadRotationMsgId,
  saveRotationState,
  loadRotationState,
  restorePreviousRotationState,
  rotationHistoryCount,
} = require('../../utils/rotationStore');
const {
  createInitialState,
  stateToEmbedData,
  stateToEditableData,
  buildEditedState,
  summarizeStateChanges,
  advanceState,
  catchUpState,
  alignStateToCurrentMonth,
  validateState,
  recoverStateFromEmbed,
  warsawToUnix,
} = require('../../utils/rotationState');
const {
  storePendingEdit,
  buildPreviewButtons,
  beginApplyInteraction,
  handleCancelInteraction,
} = require('../../utils/pendingEdits');

const PENDING_KIND = 'rotation';
let rotationOperationInProgress = false;

function getMapRotationChannelId() {
  return process.env.MAP_ROTATION_CHANNEL || null;
}

function buildRotationEmbed(state) {
  const data = stateToEmbedData(state); // validates field limits/state
  const now = Math.floor(Date.now() / 1000);
  const allEvents = state.months.flatMap(month => month.events.map(event => {
    const [year, month, day] = event.date.split('-').map(Number);
    return { ...event, unix: warsawToUnix(year, month - 1, day, event.time) };
  })).sort((a, b) => a.unix - b.unix);
  const next = allEvents.find(event => event.unix >= now);

  const renderMonth = month => {
    if (!month.events.length) return 'No matches scheduled for this month.';
    return month.events.map(event => {
      const [year, monthNumber, day] = event.date.split('-').map(Number);
      const unix = warsawToUnix(year, monthNumber - 1, day, event.time);
      const icon = unix < now ? '✅' : next?.unix === unix ? '➡️' : '•';
      return `${icon} <t:${unix}:d> · <t:${unix}:t> — **${event.map}**`;
    }).join('\n');
  };

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: 'Map Rotation', iconURL: THUMBNAIL_URL })
    .addFields(
      { name: data.month1Header.toUpperCase(), value: renderMonth(state.months[0]) },
      { name: data.month2Header.toUpperCase(), value: renderMonth(state.months[1]) }
    )
    .setFooter({ text: 'Times are shown in your local timezone' });
  if (next) embed.setDescription(`**Next event:** **${next.map}** · <t:${next.unix}:R>`);
  return embed;
}

function isRotationMessage(message, botUserId = message?.client?.user?.id) {
  return Boolean(botUserId)
    && message?.author?.id === botUserId
    && message.embeds?.[0]?.author?.name === 'Map Rotation';
}

async function findRotationMessages(channel, limit = 100) {
  const messages = await channel.messages.fetch({ limit });
  return messages.filter(message => isRotationMessage(message, channel.client.user.id));
}

function validStoredState(channelId) {
  const state = loadRotationState(channelId);
  if (!state) return null;
  try {
    validateState(state);
    return state;
  } catch (err) {
    logger.warn(`Ignoring invalid rotation state for channel ${channelId}: ${err.message}`);
    return null;
  }
}

function persistState(channelId, state) {
  const data = stateToEmbedData(state);
  saveRotationState(channelId, state);
  if (state.messageId) {
    saveRotationMsgId(channelId, state.messageId);
  }
}

async function loadOrRecoverRotation(client, channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { channel: null, message: null, state: null };

  let state = validStoredState(channelId);
  const candidateId = state?.messageId || loadRotationMsgId(channelId);
  let message = candidateId
    ? await channel.messages.fetch(candidateId).catch(() => null)
    : null;
  if (!isRotationMessage(message, client.user.id)) message = null;

  if (!message) {
    const matches = await findRotationMessages(channel).catch(() => null);
    message = matches?.first() || null;
  }

  if (!state && message) {
    state = recoverStateFromEmbed(message.embeds[0], message.id);
  }
  if (state && message && state.messageId !== message.id) {
    state = { ...state, messageId: message.id, updatedAt: new Date().toISOString() };
  }
  if (state) persistState(channelId, state);
  return { channel, message, state };
}

/**
 * Edits an existing rotation message when possible and posts only when none
 * exists. Obsolete duplicates are removed only after the new state is live.
 */
async function upsertRotation(client, state, { removeDuplicates = true } = {}) {
  const channelId = getMapRotationChannelId();
  if (!channelId) return { ok: false, reason: 'MAP_ROTATION_CHANNEL not set' };

  const recovered = await loadOrRecoverRotation(client, channelId);
  if (!recovered.channel) return { ok: false, reason: `Rotation channel <#${channelId}> is unreachable` };
  let message = recovered.message;
  const embed = buildRotationEmbed(state); // validates before changing Discord

  if (message) {
    await message.edit({ embeds: [embed], content: null });
  } else {
    message = await recovered.channel.send({ embeds: [embed] });
  }

  const persisted = { ...state, messageId: message.id, updatedAt: new Date().toISOString() };
  persistState(channelId, persisted);

  if (removeDuplicates) {
    const matches = await findRotationMessages(recovered.channel).catch(() => null);
    if (matches) {
      for (const duplicate of matches.values()) {
        if (duplicate.id !== message.id) {
          await duplicate.delete().catch(err =>
            logger.warn(`Could not remove duplicate rotation ${duplicate.id}: ${err.message}`)
          );
        }
      }
    }
  }

  return { ok: true, state: persisted, channel: recovered.channel, message };
}

async function withRotationLock(operation) {
  if (rotationOperationInProgress) return { ok: false, busy: true, reason: 'Another rotation update is already in progress.' };
  rotationOperationInProgress = true;
  try {
    return await operation();
  } finally {
    rotationOperationInProgress = false;
  }
}

async function warmRotationCache(client) {
  const channelId = getMapRotationChannelId();
  if (!channelId) return { ok: false, reason: 'no channel' };
  const recovered = await loadOrRecoverRotation(client, channelId);

  // Legacy embeds are recovered at revision 1. If such an embed starts in a
  // future month, repair the migration immediately. Later intentional manual
  // advances have higher revisions and are not silently undone on restart.
  if (recovered.state?.revision === 1) {
    const alignment = alignStateToCurrentMonth(recovered.state);
    if (alignment.reset) {
      const fixed = await upsertRotation(client, alignment.state);
      if (fixed.ok) logger.info('Realigned legacy rotation to the current Warsaw month.');
      return fixed;
    }
  }

  return { ok: Boolean(recovered.state), ...recovered };
}

async function ensureRotationPosted(client) {
  return withRotationLock(async () => {
    const channelId = getMapRotationChannelId();
    if (!channelId) return { ok: false, reason: 'MAP_ROTATION_CHANNEL not set' };
    const recovered = await loadOrRecoverRotation(client, channelId);
    const alignment = recovered.state
      ? alignStateToCurrentMonth(recovered.state)
      : { state: createInitialState(), reset: false, advances: 0 };
    const result = await upsertRotation(client, alignment.state);
    return { ...result, reset: alignment.reset, advances: alignment.advances };
  });
}

function addModalInput(modal, customId, label, style, value, maxLength) {
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(style)
      .setValue(value)
      .setMaxLength(maxLength)
      .setRequired(true)
  ));
}

async function handleAdminEditRotation(interaction) {
  const channelId = getMapRotationChannelId();
  if (!channelId) {
    return interaction.reply({ embeds: [createErrorEmbed('Config Error', 'MAP_ROTATION_CHANNEL is not set in .env.')], flags: MessageFlags.Ephemeral });
  }

  const state = validStoredState(channelId);
  if (!state) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const recovered = await loadOrRecoverRotation(interaction.client, channelId);
    if (!recovered.state) {
      return interaction.editReply({ embeds: [createErrorEmbed('Not Found', 'No Map Rotation message was found. Post one first.')] });
    }
    return interaction.editReply({
      embeds: [createSuccessEmbed('Rotation recovered', 'Click **Edit Map Rotation** again to open the editor.')],
    });
  }

  const editable = stateToEditableData(state);
  const modal = new ModalBuilder()
    .setCustomId(`rotation_edit:${channelId}:${state.messageId || '0'}:${state.revision}`)
    .setTitle('Edit Map Rotation');
  addModalInput(modal, 'month1_header', 'Month 1 (e.g. August 2026)', TextInputStyle.Short, editable.month1Header, 50);
  addModalInput(modal, 'month1_events', 'Month 1 Events (DD/MM/YYYY - Map)', TextInputStyle.Paragraph, editable.month1Events, 1000);
  addModalInput(modal, 'month2_header', 'Month 2 (e.g. September 2026)', TextInputStyle.Short, editable.month2Header, 50);
  addModalInput(modal, 'month2_events', 'Month 2 Events (DD/MM/YYYY - Map)', TextInputStyle.Paragraph, editable.month2Events, 1000);
  addModalInput(modal, 'event_time', 'Event time (24-hour HH:MM)', TextInputStyle.Short, editable.eventTime, 5);
  return interaction.showModal(modal);
}

async function handleRotationModalSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, channelId, , revisionText] = interaction.customId.split(':');
  const expectedRevision = Number(revisionText);
  const current = validStoredState(channelId);
  if (!current || current.revision !== expectedRevision) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Rotation changed', 'Another update was saved after you opened the editor. Re-open Edit Rotation and try again.')],
    });
  }

  const input = {
    month1Header: interaction.fields.getTextInputValue('month1_header'),
    month1Events: interaction.fields.getTextInputValue('month1_events'),
    month2Header: interaction.fields.getTextInputValue('month2_header'),
    month2Events: interaction.fields.getTextInputValue('month2_events'),
    eventTime: interaction.fields.getTextInputValue('event_time'),
  };
  let candidate;
  try {
    candidate = buildEditedState(input, current);
  } catch (err) {
    return interaction.editReply({ embeds: [createErrorEmbed('Invalid rotation data', err.message)] });
  }

  const nonce = storePendingEdit(PENDING_KIND, {
    channelId,
    expectedRevision,
    state: candidate,
    ownerId: interaction.user.id,
  });
  const preview = buildRotationEmbed(candidate)
    .addFields({ name: 'Change Summary', value: summarizeStateChanges(current, candidate).slice(0, 1024) });
  return interaction.editReply({
    content: '👀 **Preview** — validate the changes, then Apply or Cancel.',
    embeds: [preview],
    components: [buildPreviewButtons(PENDING_KIND, nonce)],
  });
}

async function handleRotationApplyButton(interaction) {
  const pending = await beginApplyInteraction(interaction, PENDING_KIND, 'Edit Map Rotation');
  if (!pending) return false;

  const result = await withRotationLock(async () => {
    const current = validStoredState(pending.channelId);
    if (!current || current.revision !== pending.expectedRevision) {
      await interaction.update({
        content: '',
        embeds: [createErrorEmbed('Rotation changed', 'Another update won the race. Re-open Edit Rotation so you do not overwrite newer data.')],
        components: [],
      });
      return { ok: false, conflict: true };
    }
    await interaction.update({ content: '⏳ Applying rotation edit…', embeds: [buildRotationEmbed(pending.state)], components: [] });
    return upsertRotation(interaction.client, pending.state);
  });

  if (result.busy) {
    await interaction.update({ content: '', embeds: [createErrorEmbed('Busy', result.reason)], components: [] });
    return false;
  }
  if (!result.ok) {
    if (!result.conflict) {
      await interaction.editReply({ content: '', embeds: [createErrorEmbed('Update failed', result.reason || 'Unknown error')], components: [] });
    }
    return false;
  }

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('Map Rotation Edited')
    .addFields(
      { name: 'Admin', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Revision', value: `${result.state.revision}`, inline: true }
    )
    .setTimestamp());
  await interaction.editReply({ content: '', embeds: [createSuccessEmbed('Map Rotation Updated', `Saved revision **${result.state.revision}**.`)], components: [] });
  return true;
}

async function handleRotationCancelButton(interaction) {
  return handleCancelInteraction(interaction, PENDING_KIND, '❎ Rotation edit discarded.');
}

async function handleAdminPostRotation(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await ensureRotationPosted(interaction.client);
  if (!result.ok) return interaction.editReply({ embeds: [createErrorEmbed(result.busy ? 'Busy' : 'Post failed', result.reason)] });
  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('Map Rotation Upserted')
    .addFields(
      { name: 'Admin', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Channel', value: `${result.channel}`, inline: true },
      { name: 'Revision', value: `${result.state.revision}`, inline: true }
    )
    .setTimestamp());
  return interaction.editReply({ embeds: [createSuccessEmbed('Map Rotation Ready', `Rotation is live in ${result.channel} without duplicates.`)] });
}

async function advanceRotationNow(client) {
  return withRotationLock(async () => {
    const channelId = getMapRotationChannelId();
    if (!channelId) return { ok: false, reason: 'MAP_ROTATION_CHANNEL not set' };
    const recovered = await loadOrRecoverRotation(client, channelId);
    if (!recovered.state) {
      const posted = await upsertRotation(client, createInitialState());
      return { ...posted, action: 'bootstrap', advances: 0 };
    }
    const next = advanceState(recovered.state);
    const posted = await upsertRotation(client, next);
    return { ...posted, action: 'advance', advances: 1 };
  });
}

async function maybeAutoAdvanceRotation(client) {
  return withRotationLock(async () => {
    const channelId = getMapRotationChannelId();
    if (!channelId) return { skipped: 'no channel' };
    const recovered = await loadOrRecoverRotation(client, channelId);
    if (!recovered.state) return { skipped: 'no live rotation' };
    const caughtUp = catchUpState(recovered.state);
    if (!caughtUp.advances) return { skipped: 'already on the current Warsaw month' };
    if (caughtUp.stillBehind) return { ok: false, reason: 'Rotation is more than 24 months behind; manual review required.' };
    const result = await upsertRotation(client, caughtUp.state);
    if (!result.ok) return result;
    logger.info(`Auto-advanced rotation by ${caughtUp.advances} month(s)`);
    await sendLog(client, new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('⏩ Rotation Auto-Advanced')
      .setDescription(`Caught up **${caughtUp.advances}** month(s) to the current Warsaw calendar month.`)
      .setTimestamp());
    return { ...result, advances: caughtUp.advances };
  });
}

async function handleAdminAdvanceConfirm(interaction) {
  const channelId = getMapRotationChannelId();
  const state = channelId ? validStoredState(channelId) : null;
  const window = state ? stateToEmbedData(state) : null;
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('Confirm Rotation Advance')
      .setDescription(window
        ? `Advance **${window.month1Header} / ${window.month2Header}** forward by one month?`
        : 'No stored rotation exists; this will create the current window.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rotation_advance_confirm').setLabel('Confirm Advance').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('rotation_action_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAdminResetConfirm(interaction) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle('Reset Rotation?')
      .setDescription('This rebuilds the current and next Warsaw months from the map cycle. The current state is kept in Undo history.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rotation_reset_confirm').setLabel('Reset to Current Month').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('rotation_action_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRotationActionCancel(interaction) {
  return interaction.update({ content: '❎ Rotation action cancelled.', embeds: [], components: [] });
}

async function handleAdminResetRotation(interaction) {
  await interaction.update({ content: '⏳ Resetting rotation…', embeds: [], components: [] });
  const result = await withRotationLock(async () => {
    const channelId = getMapRotationChannelId();
    const current = channelId ? validStoredState(channelId) : null;
    const fresh = createInitialState();
    if (current) {
      fresh.revision = current.revision + 1;
      fresh.messageId = current.messageId;
    }
    return upsertRotation(interaction.client, fresh);
  });
  if (!result.ok) return interaction.editReply({ embeds: [createErrorEmbed('RESET_FAILED', result.reason)], components: [] });
  return interaction.editReply({ content: '', embeds: [createSuccessEmbed('Rotation Reset', 'Restored the current Warsaw two-month window. You can Undo this change.')], components: [] });
}

async function handleAdminUndoRotation(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await withRotationLock(async () => {
    const channelId = getMapRotationChannelId();
    if (!channelId) return { ok: false, reason: 'MAP_ROTATION_CHANNEL not set' };
    const previous = restorePreviousRotationState(channelId);
    if (!previous) return { ok: false, reason: 'No rotation history is available.' };
    return upsertRotation(interaction.client, previous);
  });
  if (!result.ok) return interaction.editReply({ embeds: [createErrorEmbed('UNDO_FAILED', result.reason)] });
  return interaction.editReply({ embeds: [createSuccessEmbed('Rotation Restored', `Restored the previous state. ${rotationHistoryCount(getMapRotationChannelId())} older state(s) remain.`)] });
}

async function handleAdminAdvanceRotation(interaction) {
  if (interaction.isButton?.()) {
    await interaction.update({ content: '⏳ Advancing rotation…', embeds: [], components: [] });
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const result = await advanceRotationNow(interaction.client);
  if (!result.ok) return interaction.editReply({ embeds: [createErrorEmbed(result.busy ? 'Busy' : 'Advance failed', result.reason)] });
  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(result.action === 'bootstrap' ? 'Map Rotation Bootstrapped' : 'Map Rotation Advanced')
    .addFields(
      { name: 'Admin', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Revision', value: `${result.state.revision}`, inline: true }
    )
    .setTimestamp());
  return interaction.editReply({ embeds: [createSuccessEmbed(
    result.action === 'bootstrap' ? 'Rotation Bootstrapped' : 'Rotation Advanced',
    `Now showing **${stateToEmbedData(result.state).month1Header}** and **${stateToEmbedData(result.state).month2Header}**.`
  )] });
}

module.exports = {
  handleRotationModalSubmit,
  handleRotationApplyButton,
  handleRotationCancelButton,
  handleAdminPostRotation,
  handleAdminEditRotation,
  handleAdminAdvanceConfirm,
  handleAdminAdvanceRotation,
  handleAdminResetConfirm,
  handleAdminResetRotation,
  handleAdminUndoRotation,
  handleRotationActionCancel,
  maybeAutoAdvanceRotation,
  warmRotationCache,
  ensureRotationPosted,
  upsertRotation,
  buildRotationEmbed,
};
