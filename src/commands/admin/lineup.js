const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../utils/logger');
const { saveLineupData } = require('../../utils/lineupStore');

const TIMES = {
  matchPositions: { h: 19, m: 30 },
  slBriefing:     { h: 19, m: 30 },
  gameStart:      { h: 20, m: 0  },
};

function getWarsawOffsetHours(date) {
  const utcMs    = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const warsawMs = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' })).getTime();
  return Math.round((warsawMs - utcMs) / 3_600_000);
}

function warsawToUnix(year, month, day, hour, minute) {
  const probe       = new Date(Date.UTC(year, month, day, hour, minute, 0));
  const offsetHours = getWarsawOffsetHours(probe);
  const utcHour     = hour - offsetHours;
  return Math.floor(Date.UTC(year, month, day, utcHour, minute, 0) / 1000);
}

function warsawParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    weekday:  'short',
    hour12:   false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year:    parseInt(parts.year,   10),
    month:   parseInt(parts.month,  10) - 1,
    day:     parseInt(parts.day,    10),
    weekday: weekdayMap[parts.weekday] ?? 0,
    hour:    parseInt(parts.hour,   10),
    minute:  parseInt(parts.minute, 10),
  };
}

function getNextWednesdayTimestamps() {
  const now = new Date();
  const { year, month, day, weekday, hour } = warsawParts(now);

  let daysUntilWed = (3 - weekday + 7) % 7;
  if (daysUntilWed === 0 && hour >= 20) daysUntilWed = 7;

  const target = new Date(Date.UTC(year, month, day + daysUntilWed, 0, 0, 0));
  const tgtY = target.getUTCFullYear();
  const tgtM = target.getUTCMonth();
  const tgtD = target.getUTCDate();

  const matchUnix = warsawToUnix(tgtY, tgtM, tgtD, TIMES.matchPositions.h, TIMES.matchPositions.m);
  const slUnix    = warsawToUnix(tgtY, tgtM, tgtD, TIMES.slBriefing.h,     TIMES.slBriefing.m);
  const startUnix = warsawToUnix(tgtY, tgtM, tgtD, TIMES.gameStart.h,      TIMES.gameStart.m);

  const dd = String(tgtD).padStart(2, '0');
  const mm = String(tgtM + 1).padStart(2, '0');
  const yy = String(tgtY).slice(2);
  const dateLabel = `${dd}.${mm}.${yy}`;

  return { matchUnix, slUnix, startUnix, dateLabel };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lineup')
    .setDescription('Post the lineup to the channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('Which server (S1 or S2)')
        .setRequired(true)
        .addChoices(
          { name: 'S1', value: 'S1' },
          { name: 'S2', value: 'S2' }
        )
    )
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('Lineup image')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Channel restriction check
    const allowedChannelId = process.env.LINEUP_COMMAND_CHANNEL;
    if (allowedChannelId && interaction.channelId !== allowedChannelId) {
      return interaction.reply({
        content: `❌ This command can only be used in <#${allowedChannelId}>.`,
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 });

    const server     = interaction.options.getString('server');
    const attachment = interaction.options.getAttachment('image');

    if (!attachment.contentType?.startsWith('image/')) {
      return interaction.editReply({ content: '❌ File must be an image (PNG, JPG, etc.)' });
    }

    const lineupChannelId = process.env.LINEUP_CHANNEL;
    const channel = lineupChannelId
      ? interaction.client.channels.cache.get(lineupChannelId)
      : interaction.channel;

    if (!channel) {
      return interaction.editReply({ content: '❌ Lineup channel not found. Check `LINEUP_CHANNEL` in `.env`.' });
    }

    const { matchUnix, slUnix, startUnix } = getNextWednesdayTimestamps();
    const serverLabel = server === 'S1' ? 'Server 1' : 'Server 2';
    const defaultCaption = `**${serverLabel}** - <t:${startUnix}:D>`;

    const lineupEmbed = new EmbedBuilder()
      .setDescription(defaultCaption)
      .addFields(
        { name: 'Match Positions', value: `<t:${matchUnix}:t>`, inline: true },
        { name: 'SL Briefing',     value: `<t:${slUnix}:t>`,    inline: true },
        { name: 'Game Start',      value: `<t:${startUnix}:t>`, inline: true },
      )
      .setImage('attachment://lineup.png')
      .setColor(0x011327);

    const posted = await channel.send({
      embeds: [lineupEmbed],
      files: [{ attachment: attachment.url, name: 'lineup.png' }],
    });

    saveLineupData(channel.id, posted.id, defaultCaption, server);

    const logChannel = process.env.ADMIN_LOG_CHANNEL
      ? interaction.client.channels.cache.get(process.env.ADMIN_LOG_CHANNEL)
      : null;
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('📋 Lineup Posted')
        .setDescription(`Lineup posted to ${channel}`)
        .addFields({ name: 'Admin', value: `<@${interaction.user.id}>`, inline: true })
        .setColor(0x5865f2)
        .setTimestamp();
      logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }

    logger.info(`Lineup ${server} sent to #${channel.name} by ${interaction.user.tag}`);

    const editCaptionBtn = new ButtonBuilder()
      .setCustomId(`lineup_editcap:${channel.id}:${posted.id}:${server}`)
      .setLabel(`✏️ Edit Caption (${server})`)
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(editCaptionBtn);

    await interaction.editReply({
      content: `✅ Lineup posted to ${channel}!`,
      components: [row],
    });
  },
};
