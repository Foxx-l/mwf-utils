/**
 * lineupStore.js
 *
 * Persists lineup caption and server details data in /app/data/
 * (Docker named volume — survives restarts).
 * Prevents the 3-second Discord modal timeout by caching data locally
 * instead of scanning channels before showing the edit modal.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR    = '/app/data';
const LINEUP_PATH = path.join(DATA_DIR, 'lineup_data.json');
const SERVER_PATH = path.join(DATA_DIR, 'server_data.json');

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

// ── Lineup caption cache ─────────────────────────────────────────────────────
// Keyed by `${channelId}:${server}` when `server` ('S1' | 'S2') is provided,
// otherwise by plain `channelId`.

function _lineupKey(channelId, server) {
  return server ? `${channelId}:${server}` : channelId;
}

function saveLineupData(channelId, messageId, caption, server) {
  const store = _read(LINEUP_PATH);
  store[_lineupKey(channelId, server)] = { messageId, caption, server: server || null };
  _write(LINEUP_PATH, store);
}

function loadLineupData(channelId, server) {
  return _read(LINEUP_PATH)[_lineupKey(channelId, server)] ?? null;
}

function clearLineupData(channelId, server) {
  const store = _read(LINEUP_PATH);
  const key = _lineupKey(channelId, server);
  if (store[key] === undefined) return false;
  delete store[key];
  _write(LINEUP_PATH, store);
  return true;
}

// ── Server details cache ──────────────────────────────────────────────────────
// Keyed by `${channelId}:${server}` when `server` ('S1' | 'S2') is provided,
// otherwise by plain `channelId`.

function _serverKey(channelId, server) {
  return server ? `${channelId}:${server}` : channelId;
}

function saveServerData(channelId, messageId, serverName, serverPassword, server) {
  const store = _read(SERVER_PATH);
  store[_serverKey(channelId, server)] = { messageId, serverName, serverPassword, server: server || null };
  _write(SERVER_PATH, store);
}

function loadServerData(channelId, server) {
  return _read(SERVER_PATH)[_serverKey(channelId, server)] ?? null;
}

function clearServerData(channelId, server) {
  const store = _read(SERVER_PATH);
  const key = _serverKey(channelId, server);
  if (store[key] === undefined) return false;
  delete store[key];
  _write(SERVER_PATH, store);
  return true;
}

module.exports = {
  saveLineupData,
  loadLineupData,
  clearLineupData,
  saveServerData,
  loadServerData,
  clearServerData,
};
