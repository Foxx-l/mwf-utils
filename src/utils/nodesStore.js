/**
 * nodesStore.js
 *
 * Persists NODES embed data in /app/data/ (Docker named volume — survives restarts).
 * Prevents the 3-second Discord modal timeout by caching data locally
 * instead of making async API calls before showing the edit modal.
 */

const fs   = require('fs');
const path = require('path');

const DATA_PATH = path.join('/app/data', 'nodes_data.json');

function saveNodesData(fields) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(fields, null, 2), 'utf8');
  } catch (_) {}
}

function loadNodesData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { saveNodesData, loadNodesData };
