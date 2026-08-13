// @ts-check
/**
 * features.js — What the panel manages, and whether each part is set up.
 *
 * The single source of truth for "configured": the status rows and the dropdown
 * options both read it, so a feature can never be hidden from the list while
 * still offering actions that fail (the panel used to offer Post Nodes with
 * `NODES_CHANNELS` unset, which reached the handler and errored).
 */

const { hasEnv, listMissing } = require('../config/env');

/**
 * @typedef {Object} PanelFeature
 * @property {string} key
 * @property {string} label     shown on the status row
 * @property {string} emoji
 * @property {'embeds'|'matchday'} group  which block of the panel it belongs to
 * @property {import('../config/env').EnvRequirement} env  what makes it configured
 */

/** @type {readonly PanelFeature[]} */
const FEATURES = Object.freeze([
  { key: 'faction',  label: 'Faction Embed',  emoji: '🛡️', group: 'embeds',   env: 'FACTION_CHANNEL' },
  { key: 'lineup',   label: 'Lineup',         emoji: '📋', group: 'embeds',   env: 'LINEUP_CHANNEL' },
  { key: 'server',   label: 'Server Details', emoji: '🖥️', group: 'embeds',   env: 'SERVER_DETAILS_CHANNEL' },
  { key: 'rotation', label: 'Map Rotation',   emoji: '🗺️', group: 'embeds',   env: 'MAP_ROTATION_CHANNEL' },
  { key: 'nodes',    label: 'Nodes',          emoji: '📍', group: 'embeds',   env: 'NODES_CHANNELS' },
  { key: 'midcap',   label: 'Mid Cap Poll',   emoji: '📊', group: 'matchday', env: 'MIDCAP_CHANNEL' },
  { key: 'signups',  label: 'Signups',        emoji: '📅', group: 'matchday', env: 'RAIDHELPER_API_KEY' },
]);

/**
 * Advisory env list shown as the panel's ⚠️ row. Wider than the feature gates:
 * it also covers the values features *use* (server name/password) rather than
 * only the channels that switch them on. Distinct from the startup list in
 * config/constants.js, which is fatal.
 * @type {readonly import('../config/env').EnvRequirement[]}
 */
const ADVISORY_ENV = Object.freeze([
  'GUILD_ID',
  'FACTION_CHANNEL',
  'LINEUP_CHANNEL',
  'SERVER_DETAILS_CHANNEL',
  'MAP_ROTATION_CHANNEL',
  'NODES_CHANNELS',
  ['SERVER_S1_NAME',     'SERVER_NAME'],
  ['SERVER_S1_PASSWORD', 'SERVER_PASSWORD'],
  ['SERVER_S2_NAME',     'SERVER_NAME'],
  ['SERVER_S2_PASSWORD', 'SERVER_PASSWORD'],
]);

/** @param {string} key */
function feature(key) {
  return FEATURES.find(f => f.key === key) ?? null;
}

/**
 * Is this feature switched on in the environment? Unknown keys are treated as
 * configured, so a typo hides nothing.
 * @param {string} key
 */
function isConfigured(key) {
  const found = feature(key);
  return found ? hasEnv(found.env) : true;
}

/** Features with no env set — listed once under Setup instead of as fake 🔴 rows. */
function idleFeatures() {
  return FEATURES.filter(f => !isConfigured(f.key));
}

/** Advisory env vars that are not set. */
function listMissingEnv() {
  return listMissing(ADVISORY_ENV);
}

module.exports = { FEATURES, ADVISORY_ENV, feature, isConfigured, idleFeatures, listMissingEnv };
