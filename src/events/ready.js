const { Events, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const emojiState = require('../utils/emojiState');
const { startScheduler, startRotationScheduler } = require('../utils/scheduler');
const { warmRotationCache } = require('../handlers/interactions/rotationHandler');
const { sendLog } = require('../handlers/interactions/shared');
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

    warmRotationCache(client).catch(err =>
      logger.warn(`warmRotationCache failed: ${err.message}`)
    );

    // Post a one-line startup notice to the admin log so admins can see
    // when the bot came online and which version is running.
    const startupEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🚀 Bot Online')
      .setDescription(`Version \`${pkg.version}\` · Node ${process.version}`)
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
