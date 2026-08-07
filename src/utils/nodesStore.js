/** Persists NODES embed data in the configured data directory. */

const fs = require('fs');
const logger = require('./logger');
const { dataPath } = require('./dataDir');

const DATA_PATH = dataPath('nodes_data.json');

function saveNodesData(fields) {
  try {
    const tempPath = `${DATA_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(fields, null, 2), 'utf8');
    fs.renameSync(tempPath, DATA_PATH);
    return true;
  } catch (err) {
    logger.warn(`Could not write ${DATA_PATH}: ${err.message}`);
    return false;
  }
}

function loadNodesData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Could not read ${DATA_PATH}: ${err.message}`);
    return null;
  }
}

module.exports = { saveNodesData, loadNodesData };
