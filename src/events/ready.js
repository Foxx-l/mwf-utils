const { Events, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const { COLORS } = require('../config/theme');
const emojiState = require('../utils/emojiState');
const { startScheduler, startRotationScheduler } = require('../utils/scheduler');
const { warmRotationCache } = require('../handlers/interactions/rotationHandler');
const { sendLog } = require('../handlers/interactions/shared');
const { ensureDataDir, DATA_DIR } = require('../utils/dataDir');
const pkg = require('../../package.json');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Bot is online as ${client.user.tag}`);
    logger.info(`Active in ${client.guilds.cache.size} guild(s)`);

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
      await ensureEmojis(guild);
    }

    startScheduler(client);
    startRotationScheduler(client);

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
  }
};

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
