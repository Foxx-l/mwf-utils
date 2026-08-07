const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

module.exports = (client) => {
  const eventsPath = path.join(__dirname, '..', 'events');
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);

    try {
      const event = require(filePath);

      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
        logger.info(`Loaded event (once): ${event.name}`);
      } else {
        client.on(event.name, (...args) => event.execute(...args));
        logger.info(`Loaded event (on): ${event.name}`);
      }
    } catch (error) {
      logger.error(`Failed to load event from ${file}:`, error);
    }
  }

  logger.success(`All event listeners loaded`);
};
