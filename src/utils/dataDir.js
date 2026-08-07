const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return true;
  } catch (err) {
    logger.error(`Could not create data directory ${DATA_DIR}: ${err.message}`);
    return false;
  }
}

function dataPath(fileName) {
  ensureDataDir();
  return path.join(DATA_DIR, fileName);
}

module.exports = { DATA_DIR, ensureDataDir, dataPath };
