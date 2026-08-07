/**
 * rotationHandler.js — Handles Map Rotation post and edit interactions.
 *
 * Rotation is posted as a Discord embed.
 * Raw event lines are persisted in /tmp/ for round-trip editing.
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
const { sendLog } = require('./shared');
const { THUMBNAIL_URL } = require('../../config/constants');
const {
  saveRotationRaw,
  loadRotationRaw,
  saveRotationMsgId,
  loadRotationMsgId
} = require('../../utils/rotationStore');
const {
  advanceRotationData,
  bootstrapRotationData,
  shouldAdvanceNow
} = require('../../utils/rotationCycle');
const {
  storePendingEdit,
  buildPreviewButtons,
  beginApplyInteraction,
  handleCancelInteraction,
} = require('../../utils/pendingEdits');

const PENDING_KIND = 'rotation';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMapRotationChannelId() {
  return process.env.MAP_ROTATION_CHANNEL || null;
}

function getDefaultRotationData() {
  const now        = new Date();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const m1 = now.getMonth();
  const m2 = (m1 + 1) % 12;
  const y1 = now.getFullYear();
  const y2 = m2 === 0 ? y1 + 1 : y1;
  return {
    month1Header: `${monthNames[m1]} ${y1}`,
    month1Events: '— No events scheduled —',
    month2Header: `${monthNames[m2]} ${y2}`,
    month2Events: '— No events scheduled —'
  };
}

/**
 * Returns the UTC offset for Europe/Warsaw at the given date, in hours.
 * Uses Intl to correctly handle DST transitions.
 */
function getWarsawOffsetHours(date) {
  const utcMs    = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const warsawMs = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' })).getTime();
  return Math.round((warsawMs - utcMs) / 3_600_000);
}

/**
 * Converts "<t:unix:f> - **MapName**" lines back to "DD/MM/YYYY - MapName"
 * (using Europe/Warsaw for the date). Lines that don't match are passed through.
 */
function reverseParseEventLines(text) {
  if (!text) return '';
  return text.split('\n').map(line => {
    const m = line.trim().match(/^<t:(\d+):[a-zA-Z]>\s*-\s*\*\*\s*(.+?)\s*\*\*\s*$/);
    if (!m) return line;
    const [, unixStr, rawMap] = m;
    const mapName = rawMap.replace(/`/g, '').trim();
    const d = new Date(parseInt(unixStr, 10) * 1000);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      day:   '2-digit',
      month: '2-digit',
      year:  'numeric'
    }).formatToParts(d);
    const dd   = parts.find(p => p.type === 'day').value;
    const mm   = parts.find(p => p.type === 'month').value;
    const yyyy = parts.find(p => p.type === 'year').value;
    return `${dd}/${mm}/${yyyy} - ${mapName}`;
  }).join('\n');
}

/**
 * Converts raw embed text to the DD/MM/YYYY editable form used by the modal.
 */
function toEditableForm(data) {
  if (!data) return null;
  return {
    month1Header: data.month1Header,
    month1Events: reverseParseEventLines(data.month1Events),
    month2Header: data.month2Header,
    month2Events: reverseParseEventLines(data.month2Events)
  };
}

/**
 * Fetches the live rotation message from Discord, preferring the stored messageId
 * but falling back to a channel scan when that message is missing or isn't a rotation
 * embed. Updates the stored messageId when a newer rotation is found.
 * Returns the refreshed raw data, or null if nothing usable was found.
 */
async function syncRotationFromChannel(client, channelId, storedMsgId) {
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch) return null;

    let msg = storedMsgId
      ? await ch.messages.fetch(storedMsgId).catch(() => null)
      : null;

    const isRotation = (m) => m?.embeds?.[0]?.author?.name === 'Map Rotation';

    if (!isRotation(msg)) {
      msg = await findRotationMessage(ch);
    }
    if (!isRotation(msg)) return null;

    const fields = msg.embeds[0].fields ?? [];
    if (fields.length < 2) return null;

    const data = {
      month1Header: fields[0].name,
      month1Events: fields[0].value,
      month2Header: fields[1].name,
      month2Events: fields[1].value
    };

    if (msg.id !== storedMsgId) {
      saveRotationMsgId(channelId, msg.id);
    }
    saveRotationRaw(msg.id, data);
    return data;
  } catch (_) {
    return null;
  }
}

/**
 * Fires-and-forgets a sync so the next Edit Rotation click sees fresh data.
 */
function refreshRotationRawInBackground(client, channelId, messageId) {
  syncRotationFromChannel(client, channelId, messageId).catch(() => {});
}

/**
 * Runs on bot startup so the rotation cache is warm before any user clicks Edit.
 */
async function warmRotationCache(client) {
  const channelId = getMapRotationChannelId();
  if (!channelId) return;
  const storedMsgId = loadRotationMsgId(channelId);
  await syncRotationFromChannel(client, channelId, storedMsgId);
}

/**
 * Converts lines matching "DD/MM/YYYY - MapName" to Discord timestamps.
 * Event time is assumed to be 20:00 Europe/Warsaw.
 */
function parseEventLines(text) {
  return text.split('\n').map(line => {
    const match = line.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(.+)$/);
    if (!match) return line.trim();
    const [, dd, mm, yyyy, mapName] = match;

    const probe       = new Date(`${yyyy}-${mm}-${dd}T20:00:00Z`);
    const offsetHours = getWarsawOffsetHours(probe);
    const utcHour     = 20 - offsetHours;
    const unix        = Math.floor(
      new Date(`${yyyy}-${mm}-${dd}T${String(utcHour).padStart(2, '0')}:00:00Z`).getTime() / 1000
    );

    return `<t:${unix}:f> - **${mapName.trim()}**`;
  }).join('\n');
}

/**
 * Builds the Map Rotation embed.
 * Uses setAuthor so the logo appears on the left next to the title.
 */
function buildRotationEmbed(data) {
  return new EmbedBuilder()
    .setColor(0x011327)
    .setAuthor({ name: 'Map Rotation', iconURL: THUMBNAIL_URL })
    .addFields(
      { name: data.month1Header, value: data.month1Events || '— No events scheduled —' },
      { name: data.month2Header, value: data.month2Events || '— No events scheduled —' }
    );
}

/**
 * Scans the last 50 messages in a channel to find an existing rotation embed
 * (used as fallback when the message ID is not stored in /tmp/).
 */
async function findRotationMessage(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    return messages.find(m =>
      m.author.bot &&
      m.embeds.length > 0 &&
      m.embeds[0].author?.name === 'Map Rotation'
    ) ?? null;
  } catch (_) {
    return null;
  }
}

// ── Map Rotation Modal Submit ─────────────────────────────────────────────────
//
// To avoid accidental overwrites, modal submit does NOT save directly.
// Instead, the parsed payload is stashed in-memory keyed by a nonce and an
// ephemeral preview embed + Apply / Cancel buttons is shown. The actual
// message edit runs only when Apply is clicked.

async function handleRotationModalSubmit(interaction) {
  await interaction.deferReply({ flags: 64 });

  const parts     = interaction.customId.split(':');
  const channelId = parts[1];
  const messageId = parts[2];

  const month1Header = interaction.fields.getTextInputValue('month1_header');
  const month1Raw    = interaction.fields.getTextInputValue('month1_events');
  const month2Header = interaction.fields.getTextInputValue('month2_header');
  const month2Raw    = interaction.fields.getTextInputValue('month2_events');

  const month1Events = parseEventLines(month1Raw);
  const month2Events = parseEventLines(month2Raw);

  const data = { month1Header, month1Events, month2Header, month2Events };
  const rawInputs = { month1Header, month1Events: month1Raw, month2Header, month2Events: month2Raw };
  const previewEmbed = buildRotationEmbed(data);

  const nonce = storePendingEdit(PENDING_KIND, {
    channelId,
    messageId,
    data,
    rawInputs,
    ownerId: interaction.user.id,
  });

  return interaction.editReply({
    content: '👀 **Preview** — check the dates/maps below, then click **Apply** to publish or **Cancel** to discard.',
    embeds: [previewEmbed],
    components: [buildPreviewButtons(PENDING_KIND, nonce)],
  });
}

async function handleRotationApplyButton(interaction) {
  const pending = await beginApplyInteraction(interaction, PENDING_KIND, 'Edit Map Rotation');
  if (!pending) return false;

  const { channelId, messageId, data, rawInputs } = pending;
  const embed = buildRotationEmbed(data);

  await interaction.update({
    content: '⏳ Applying rotation edit…',
    embeds: [embed],
    components: [],
  });

  try {
    const ch  = await interaction.client.channels.fetch(channelId);
    const msg = await ch.messages.fetch(messageId);

    await msg.edit({ embeds: [embed], content: null });
    saveRotationRaw(messageId, rawInputs);

    logger.info(`${interaction.user.tag} updated Map Rotation in #${ch.name}`);

    await sendLog(interaction.client, new EmbedBuilder()
      .setColor(0x011327)
      .setTitle('Map Rotation Edited')
      .addFields(
        { name: 'Admin',   value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Channel', value: `<#${channelId}>`,           inline: true }
      )
      .setTimestamp()
    );

    return interaction.editReply({
      content: '',
      embeds: [createSuccessEmbed('Map Rotation Updated', 'The rotation has been updated successfully.')],
      components: [],
    });
  } catch (err) {
    logger.error('Failed to edit Map Rotation:', err);
    await interaction.editReply({
      content: '',
      embeds: [createErrorEmbed('Error', 'Could not edit the message. It may be too old or I lack permissions.')],
      components: [],
    });
    return false;
  }
}

async function handleRotationCancelButton(interaction) {
  return handleCancelInteraction(interaction, PENDING_KIND, '❎ Rotation edit discarded.');
}

// ── Admin: Post Map Rotation ──────────────────────────────────────────────────

async function handleAdminPostRotation(interaction) {
  await interaction.deferReply({ flags: 64 });

  const channelId = getMapRotationChannelId();
  if (!channelId) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Config Error', 'MAP_ROTATION_CHANNEL is not set in .env.')]
    });
  }

  const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!ch) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Channel Not Found', `Could not find channel <#${channelId}>. Check MAP_ROTATION_CHANNEL in .env.`)]
    });
  }

  const data  = getDefaultRotationData();
  const embed = buildRotationEmbed(data);

  const prevMsgId = loadRotationMsgId(channelId);
  if (prevMsgId) {
    const prevMsg = await ch.messages.fetch(prevMsgId).catch(() => null);
    if (prevMsg) await prevMsg.delete().catch(() => {});
  }

  const msg   = await ch.send({ embeds: [embed] });

  saveRotationMsgId(channelId, msg.id);
  saveRotationRaw(msg.id, data);

  logger.info(`${interaction.user.tag} posted Map Rotation to #${ch.name}`);

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(0x011327)
    .setTitle('Map Rotation Posted')
    .addFields(
      { name: 'Admin',   value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Channel', value: `<#${channelId}>`,           inline: true }
    )
    .setTimestamp()
  );

  return interaction.editReply({
    embeds: [createSuccessEmbed('Map Rotation Posted', `Posted to <#${channelId}>!\nUse **Edit Rotation** to fill in the events.`)]
  });
}

// ── Admin: Edit Map Rotation (panel button) ───────────────────────────────────

async function handleAdminEditRotation(interaction) {
  const channelId = getMapRotationChannelId();
  if (!channelId) {
    return interaction.reply({
      embeds: [createErrorEmbed('Config Error', 'MAP_ROTATION_CHANNEL is not set in .env.')],
      flags: 64
    });
  }

  let storedMsgId = loadRotationMsgId(channelId);

  if (!storedMsgId) {
    await interaction.deferReply({ flags: 64 });
    const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (ch) {
      const found = await findRotationMessage(ch);
      if (found) {
        storedMsgId = found.id;
        saveRotationMsgId(channelId, found.id);
        const fields = found.embeds[0]?.fields ?? [];
        if (fields.length >= 2) {
          saveRotationRaw(found.id, {
            month1Header: fields[0].name,
            month1Events: fields[0].value,
            month2Header: fields[1].name,
            month2Events: fields[1].value
          });
        }
      }
    }
    if (!storedMsgId) {
      return interaction.editReply({
        content: '❌ No Map Rotation message found. Post one first using **Post Rotation**.',
      });
    }
    return interaction.editReply({
      embeds: [createSuccessEmbed('Ready', 'Message found! Please click **Edit Rotation** again to open the editor.')]
    });
  }

  const data = toEditableForm(loadRotationRaw(storedMsgId)) ?? getDefaultRotationData();
  refreshRotationRawInBackground(interaction.client, channelId, storedMsgId);

  const modal = new ModalBuilder()
    .setCustomId(`rotation_edit:${channelId}:${storedMsgId}`)
    .setTitle('Edit Map Rotation');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('month1_header')
        .setLabel('Month 1 (e.g. April 2026)')
        .setStyle(TextInputStyle.Short)
        .setValue(data.month1Header)
        .setMaxLength(50)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('month1_events')
        .setLabel('Month 1 Events (DD/MM/YYYY - MapName)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(data.month1Events)
        .setMaxLength(1000)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('month2_header')
        .setLabel('Month 2 (e.g. May 2026)')
        .setStyle(TextInputStyle.Short)
        .setValue(data.month2Header)
        .setMaxLength(50)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('month2_events')
        .setLabel('Month 2 Events (DD/MM/YYYY - MapName)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(data.month2Events)
        .setMaxLength(1000)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

// ── Admin: Advance Rotation (manual + scheduler) ──────────────────────────────

/**
 * Core routine that advances the live Map Rotation embed by one month.
 * - If no embed exists, posts a fresh bootstrap.
 * - If an embed exists, computes the next rolling window (month2 → month1,
 *   new month generated below) and edits the message in place.
 *
 * Returns { ok, action, data, channelId, messageId } on success, or
 * { ok: false, reason } on failure.
 */
async function advanceRotationNow(client) {
  const channelId = getMapRotationChannelId();
  if (!channelId) return { ok: false, reason: 'MAP_ROTATION_CHANNEL not set' };

  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return { ok: false, reason: `Rotation channel <#${channelId}> unreachable` };

  const storedMsgId = loadRotationMsgId(channelId);
  const live = await syncRotationFromChannel(client, channelId, storedMsgId);

  if (!live) {
    const fresh = bootstrapRotationData();
    const msg   = await ch.send({ embeds: [buildRotationEmbed(fresh)] });
    saveRotationMsgId(channelId, msg.id);
    saveRotationRaw(msg.id, fresh);
    return { ok: true, action: 'bootstrap', data: fresh, channelId, messageId: msg.id };
  }

  const next = advanceRotationData(live);
  const msgId = loadRotationMsgId(channelId);
  try {
    const msg = await ch.messages.fetch(msgId);
    await msg.edit({ embeds: [buildRotationEmbed(next)], content: null });
    saveRotationRaw(msgId, next);
    return { ok: true, action: 'advance', data: next, channelId, messageId: msgId };
  } catch (err) {
    logger.error(`advanceRotationNow failed to edit message ${msgId}: ${err.message}`);
    return { ok: false, reason: 'Could not edit rotation message (deleted or missing permissions).' };
  }
}

/**
 * Scheduler-friendly wrapper: advances only when month1 events are entirely
 * in the past. Safe to invoke on a daily cron.
 */
async function maybeAutoAdvanceRotation(client) {
  const channelId = getMapRotationChannelId();
  if (!channelId) return { skipped: 'no channel' };

  const storedMsgId = loadRotationMsgId(channelId);
  const live = storedMsgId
    ? await syncRotationFromChannel(client, channelId, storedMsgId)
    : null;

  if (!live) return { skipped: 'no live rotation' };
  if (!shouldAdvanceNow(live)) return { skipped: 'month1 not fully elapsed' };

  const result = await advanceRotationNow(client);
  if (result.ok) {
    logger.info(`Auto-advanced rotation to ${result.data.month1Header} / ${result.data.month2Header}`);
    await sendLog(client, new EmbedBuilder()
      .setColor(0x011327)
      .setTitle('⏩ Rotation Auto-Advanced')
      .setDescription(`Rolled forward to **${result.data.month1Header}** / **${result.data.month2Header}**.`)
      .setTimestamp()
    );
  }
  return result;
}

async function handleAdminAdvanceRotation(interaction) {
  await interaction.deferReply({ flags: 64 });

  const result = await advanceRotationNow(interaction.client);
  if (!result.ok) {
    return interaction.editReply({ embeds: [createErrorEmbed('Advance Failed', result.reason)] });
  }

  logger.info(`${interaction.user.tag} advanced Map Rotation (${result.action})`);

  await sendLog(interaction.client, new EmbedBuilder()
    .setColor(0x011327)
    .setTitle(result.action === 'bootstrap' ? 'Map Rotation Bootstrapped' : 'Map Rotation Advanced')
    .addFields(
      { name: 'Admin',  value: `<@${interaction.user.id}>`,                 inline: true },
      { name: 'Window', value: `${result.data.month1Header} → ${result.data.month2Header}`, inline: true }
    )
    .setTimestamp()
  );

  const lines = [
    `**${result.data.month1Header}**`,
    result.data.month1Events || '— No events scheduled —',
    '',
    `**${result.data.month2Header}**`,
    result.data.month2Events || '— No events scheduled —'
  ].join('\n').slice(0, 4000);

  return interaction.editReply({
    embeds: [createSuccessEmbed(
      result.action === 'bootstrap' ? 'Rotation Bootstrapped' : 'Rotation Advanced',
      lines
    )]
  });
}

module.exports = {
  handleRotationModalSubmit,
  handleRotationApplyButton,
  handleRotationCancelButton,
  handleAdminPostRotation,
  handleAdminEditRotation,
  handleAdminAdvanceRotation,
  maybeAutoAdvanceRotation,
  warmRotationCache
};
