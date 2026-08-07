/**
 * lastActionStore.js
 *
 * Persists the most recent admin action so the panel footer can show
 * "last: <action> by <@user> Nm ago" without having to scan #admin-logs.
 */

const fs   = require('fs');
const path = require('path');

const DATA_PATH = path.join('/app/data', 'last_action.json');

function saveLastAction(action, userId, userTag) {
  try {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify({ action, userId, userTag, ts: Date.now() }, null, 2),
      'utf8'
    );
  } catch (_) {}
}

function loadLastAction() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { saveLastAction, loadLastAction };
