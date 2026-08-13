// @ts-check
/**
 * env.js — Reading environment configuration.
 *
 * One predicate for "is this configured", because the panel has to hide a
 * feature's status row and its dropdown options on exactly the same condition —
 * an action offered for something that isn't set up just dead-ends in the
 * handler. An entry is either a key, or a list of keys of which any one
 * satisfies it (that is how the legacy `SERVER_NAME` fallbacks work).
 *
 * @typedef {string|string[]} EnvRequirement
 */

/** Trimmed value of one key, or `''` when unset/blank. */
function envValue(key) {
  return String(process.env[key] ?? '').trim();
}

/**
 * Is this requirement satisfied?
 * @param {EnvRequirement} entry
 */
function hasEnv(entry) {
  const keys = Array.isArray(entry) ? entry : [entry];
  return keys.some(key => envValue(key) !== '');
}

/**
 * Are all of them satisfied?
 * @param {readonly EnvRequirement[]} entries
 */
function hasAllEnv(entries) {
  return entries.every(hasEnv);
}

/**
 * The unsatisfied requirements, named by their primary key — the one an admin
 * should set, not the legacy alternative.
 * @param {readonly EnvRequirement[]} entries
 * @returns {string[]}
 */
function listMissing(entries) {
  return entries
    .filter(entry => !hasEnv(entry))
    .map(entry => (Array.isArray(entry) ? entry[0] : entry));
}

/**
 * A comma-separated env var as a list (`NODES_CHANNELS`, `ALLOWED_GUILDS`, …).
 * @param {string} key
 * @returns {string[]}
 */
function csvValues(key) {
  return envValue(key).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * First entry of a comma-separated env var, or `null`.
 * @param {string} key
 */
function firstCsvValue(key) {
  return csvValues(key)[0] ?? null;
}

module.exports = { envValue, hasEnv, hasAllEnv, listMissing, csvValues, firstCsvValue };
