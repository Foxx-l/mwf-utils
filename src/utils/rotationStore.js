/**
 * rotationStore.js
 *
 * Persists rotation data in /app/data/ (Docker named volume — survives restarts).
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = '/app/data';
const RAW_PATH = path.join(DATA_DIR, 'rotation_raw.json');
const MSG_PATH = path.join(DATA_DIR, 'rotation_msg.json');

function _read(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function _write(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}

// ── Raw event text (for edit round-trip) ─────────────────────────────────────

function saveRotationRaw(messageId, data) {
  const store = _read(RAW_PATH);
  store[messageId] = data;
  _write(RAW_PATH, store);
}

function loadRotationRaw(messageId) {
  return _read(RAW_PATH)[messageId] ?? null;
}

// ── Message ID per channel ────────────────────────────────────────────────────

function saveRotationMsgId(channelId, messageId) {
  const store = _read(MSG_PATH);
  store[channelId] = messageId;
  _write(MSG_PATH, store);
}

function loadRotationMsgId(channelId) {
  return _read(MSG_PATH)[channelId] ?? null;
}

function clearRotationMsgId(channelId) {
  const store = _read(MSG_PATH);
  if (store[channelId] === undefined) return false;
  delete store[channelId];
  _write(MSG_PATH, store);
  return true;
}

module.exports = {
  saveRotationRaw,
  loadRotationRaw,
  saveRotationMsgId,
  loadRotationMsgId,
  clearRotationMsgId,
};
