/** Persists the most recent admin action for the panel footer. */

const fs = require('fs');
const logger = require('./logger');
const { dataPath } = require('./dataDir');

const DATA_PATH = dataPath('last_action.json');

function saveLastAction(action, userId, userTag) {
  try {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify({ action, userId, userTag, ts: Date.now() }, null, 2),
      'utf8'
    );
    return true;
  } catch (err) {
    logger.warn(`Could not save last action to ${DATA_PATH}: ${err.message}`);
    return false;
  }
}

function loadLastAction() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Could not read ${DATA_PATH}: ${err.message}`);
    return null;
  }
}

module.exports = { saveLastAction, loadLastAction };
