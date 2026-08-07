require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const logger = require('./utils/logger');
const { REQUIRED_ENV_VARS } = require('./config/constants');
const { sendLog } = require('./handlers/interactions/shared');

const missing = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,  // required for channel.messages.fetch() in admin tools
  ]
});

client.commands = new Collection();

const loadCommands = require('./handlers/commandHandler');
const loadEvents   = require('./handlers/eventHandler');

loadCommands(client);
loadEvents(client);

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

// Best-effort shutdown notice: post to the admin log channel with a short
// timeout so SIGTERM/SIGINT still exits promptly even if Discord is slow.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Bot shutting down (${signal})...`);
  try {
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('🛑 Bot Offline')
      .setDescription(`Signal: \`${signal}\` · Restart / maintenance in progress.`)
      .setTimestamp();
    await Promise.race([
      sendLog(client, embed),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  } catch (err) {
    logger.debug(`shutdown notify failed: ${err.message}`);
  }
  try {
    client.destroy();
  } catch (err) {
    logger.debug(`client.destroy failed: ${err.message}`);
  }
  process.exit(0);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

client.login(process.env.BOT_TOKEN);
