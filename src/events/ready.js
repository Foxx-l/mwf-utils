const { Events, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const { COLORS } = require('../config/theme');
const emojiState = require('../utils/emojiState');
const { createFactionButtons } = require('../utils/buttons');
const { startScheduler, startRotationScheduler, startMidCapScheduler, startSignupScheduler } = require('../utils/scheduler');
const { warmRotationCache } = require('../handlers/interactions/rotationHandler');
const { sendLog } = require('../handlers/interactions/shared');
const { ensureDataDir, DATA_DIR } = require('../utils/dataDir');
const pkg = require('../../package.json');

module.exports = {
  // eventHandler reads name/once/execute; refreshFactionButtons is exported for
  // its test.
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Bot is online as ${client.user.tag}`);
    logger.info(`Active in ${client.guilds.cache.size} guild(s)`);

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
      await ensureEmojis(guild);
      await refreshFactionButtons(client);
    }

    startScheduler(client);
    startRotationScheduler(client);
    startMidCapScheduler(client);
    startSignupScheduler(client);

    const dataWritable = ensureDataDir();
    const rotation = await warmRotationCache(client).catch(err => {
      logger.warn(`warmRotationCache failed: ${err.message}`);
      return { ok: false, reason: err.message };
    });

    // Same dark navy as every other embed; status is conveyed by the ✅/⚠️
    // in the fields, not by the stripe color.
    const startupEmbed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('🚀 Bot Online')
      .setDescription(`Version \`${pkg.version}\` · Node ${process.version}`)
      .addFields(
        { name: 'Persistent Data', value: dataWritable ? `✅ Writable\n\`${DATA_DIR}\`` : '❌ Not writable', inline: true },
        { name: 'Rotation', value: rotation.ok ? '✅ Synchronized' : `⚠️ ${rotation.reason || 'Not posted'}`, inline: true },
        { name: 'Schedulers', value: '✅ Started', inline: true }
      )
      .setTimestamp();
    sendLog(client, startupEmbed).catch(() => {});
  },
  refreshFactionButtons,
};

/**
 * Buttons are baked into the faction embed when it is posted; if the custom
 * emojis ever load after that (or were missing at post time), the embed keeps
 * showing the fallback circles forever. Re-render the button row on every
 * startup so the embed self-heals.
 */
async function refreshFactionButtons(client) {
  const channelId = process.env.FACTION_CHANNEL;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const factionMessage = messages?.find(m =>
      m.author.id === client.user.id &&
      m.embeds.some(e => e.title === 'Choose your side!')
    );
    if (!factionMessage) return;
    await factionMessage.edit({ components: [createFactionButtons()] });
    logger.info('Faction embed buttons refreshed with current emojis.');
  } catch (err) {
    logger.warn(`Could not refresh faction buttons: ${err.message}`);
  }
}

async function ensureEmojis(guild) {
  const emojiConfigs = [
    { name: 'ALLIES', file: 'ALLIES.png' },
    { name: 'AXIS', file: 'AXIS.PNG' }
  ];

  for (const { name, file } of emojiConfigs) {
    try {
      let emoji = guild.emojis.cache.find(e => e.name === name);
      if (!emoji) {
        emoji = await guild.emojis.create({
          attachment: path.join(__dirname, '../../assets', file),
          name
        });
        logger.info(`Created emoji: ${name} (${emoji.id})`);
      } else {
        logger.info(`Emoji already exists: ${name} (${emoji.id})`);
      }
      emojiState[name] = emoji.id;
    } catch (err) {
      logger.warn(`Could not load emoji ${name}: ${err.message}`);
    }
  }
}
