const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

module.exports = (client) => {
  const commandsPath = path.join(__dirname, '..', 'commands');
  let count = 0;

  function loadCommands(dir) {
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        loadCommands(fullPath);
      } else if (file.endsWith('.js')) {
        try {
          const command = require(fullPath);
          if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            count++;
            logger.info(`Loaded command: ${command.data.name}`);
          } else {
            logger.warn(`Skipped invalid command at ${fullPath}`);
          }
        } catch (error) {
          logger.error(`Failed to load command at ${fullPath}:`, error);
        }
      }
    }
  }

  loadCommands(commandsPath);
  logger.success(`Loaded ${count} slash commands`);
};
