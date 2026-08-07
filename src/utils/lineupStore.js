/** Persists lineup captions and server details in the configured data directory. */

const fs = require('fs');
const logger = require('./logger');
const { dataPath } = require('./dataDir');

const LINEUP_PATH = dataPath('lineup_data.json');
const SERVER_PATH = dataPath('server_data.json');

function _read(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Could not read ${filePath}: ${err.message}`);
    return {};
  }
}

function _write(filePath, data) {
  try {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    logger.warn(`Could not write ${filePath}: ${err.message}`);
    return false;
  }
}

function _lineupKey(channelId, server) {
  return server ? `${channelId}:${server}` : channelId;
}

function saveLineupData(channelId, messageId, caption, server) {
  const store = _read(LINEUP_PATH);
  store[_lineupKey(channelId, server)] = { messageId, caption, server: server || null };
  return _write(LINEUP_PATH, store);
}

function loadLineupData(channelId, server) {
  return _read(LINEUP_PATH)[_lineupKey(channelId, server)] ?? null;
}

function clearLineupData(channelId, server) {
  const store = _read(LINEUP_PATH);
  const key = _lineupKey(channelId, server);
  if (store[key] === undefined) return false;
  delete store[key];
  return _write(LINEUP_PATH, store);
}

function _serverKey(channelId, server) {
  return server ? `${channelId}:${server}` : channelId;
}

function saveServerData(channelId, messageId, serverName, serverPassword, server) {
  const store = _read(SERVER_PATH);
  store[_serverKey(channelId, server)] = { messageId, serverName, serverPassword, server: server || null };
  return _write(SERVER_PATH, store);
}

function loadServerData(channelId, server) {
  return _read(SERVER_PATH)[_serverKey(channelId, server)] ?? null;
}

function clearServerData(channelId, server) {
  const store = _read(SERVER_PATH);
  const key = _serverKey(channelId, server);
  if (store[key] === undefined) return false;
  delete store[key];
  return _write(SERVER_PATH, store);
}

module.exports = {
  saveLineupData,
  loadLineupData,
  clearLineupData,
  saveServerData,
  loadServerData,
  clearServerData,
};
