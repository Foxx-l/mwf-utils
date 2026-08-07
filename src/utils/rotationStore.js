// @ts-check
/** Persists rotation data in the configured data directory. */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { dataPath } = require('./dataDir');

const MSG_PATH = dataPath('rotation_msg.json');
const STATE_PATH = dataPath('rotation_state.json');
const HISTORY_PATH = dataPath('rotation_history.json');
const BACKUP_DIR = dataPath('backups');
const HISTORY_LIMIT = 10;

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

function saveRotationMsgId(channelId, messageId) {
  const store = _read(MSG_PATH);
  store[channelId] = messageId;
  return _write(MSG_PATH, store);
}

function loadRotationMsgId(channelId) {
  return _read(MSG_PATH)[channelId] ?? null;
}

function clearRotationMsgId(channelId) {
  const store = _read(MSG_PATH);
  if (store[channelId] === undefined) return false;
  delete store[channelId];
  return _write(MSG_PATH, store);
}

function _backupState(channelId, state) {
  if (!state) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUP_DIR, `rotation-${channelId}-${stamp}.json`), JSON.stringify(state, null, 2));
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith(`rotation-${channelId}-`))
      .sort()
      .reverse();
    for (const old of files.slice(HISTORY_LIMIT)) fs.unlinkSync(path.join(BACKUP_DIR, old));
  } catch (err) {
    logger.warn(`Could not back up rotation state: ${err.message}`);
  }
}

function saveRotationState(channelId, state) {
  const store = _read(STATE_PATH);
  const previous = store[channelId];
  if (previous && previous.revision !== state.revision) {
    const history = _read(HISTORY_PATH);
    history[channelId] = [previous, ...(history[channelId] || [])].slice(0, HISTORY_LIMIT);
    _write(HISTORY_PATH, history);
    _backupState(channelId, previous);
  }
  store[channelId] = state;
  return _write(STATE_PATH, store);
}

function restorePreviousRotationState(channelId) {
  const history = _read(HISTORY_PATH);
  const entries = history[channelId] || [];
  if (!entries.length) return null;
  const previous = entries.shift();
  history[channelId] = entries;
  _write(HISTORY_PATH, history);
  const store = _read(STATE_PATH);
  const current = store[channelId];
  _backupState(channelId, current);
  const restored = {
    ...previous,
    revision: (current?.revision || previous.revision) + 1,
    messageId: current?.messageId || previous.messageId,
    updatedAt: new Date().toISOString(),
  };
  store[channelId] = restored;
  _write(STATE_PATH, store);
  return restored;
}

function rotationHistoryCount(channelId) {
  return (_read(HISTORY_PATH)[channelId] || []).length;
}

function loadRotationState(channelId) {
  return _read(STATE_PATH)[channelId] ?? null;
}

function clearRotationState(channelId) {
  const store = _read(STATE_PATH);
  if (store[channelId] === undefined) return false;
  delete store[channelId];
  return _write(STATE_PATH, store);
}

module.exports = {
  saveRotationMsgId,
  loadRotationMsgId,
  clearRotationMsgId,
  saveRotationState,
  loadRotationState,
  clearRotationState,
  restorePreviousRotationState,
  rotationHistoryCount,
};
