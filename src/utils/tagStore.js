// @ts-check
/**
 * tagStore.js — Persists the list of known clan tags in the configured data
 * directory (ported from the standalone TagSelector bot's `tags.json`).
 *
 * Only the tag strings are stored. A tag's Discord role is matched by role
 * *name* when the tag is applied, so no role IDs need to live here and an
 * admin can add or rename the role at any time.
 *
 * Tags are compared case-insensitively but stored with the spelling the admin
 * typed — that spelling is what ends up in the `[TAG]` nickname prefix.
 */

const fs = require('fs');
const logger = require('./logger');
const { dataPath } = require('./dataDir');
const { DEFAULT_CLAN_TAGS, MAX_TAG_LENGTH } = require('../config/constants');

const DATA_PATH = dataPath('tags_data.json');

/**
 * Drops blanks and case-insensitive duplicates, keeping first-seen order.
 * The legacy TagSelector file contained an empty-string entry, so blanks are
 * filtered on read rather than trusted.
 * @param {unknown} tags
 * @returns {string[]}
 */
function _normalize(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * Reads the tag list. A missing file (first boot) seeds the defaults; an
 * existing file is trusted as-is, so removing every tag stays removed.
 * @returns {string[]}
 */
function _read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return _normalize(parsed?.tags);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Could not read ${DATA_PATH}: ${err.message}`);
    return _normalize(DEFAULT_CLAN_TAGS);
  }
}

/** @param {string[]} tags */
function _write(tags) {
  try {
    const tempPath = `${DATA_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ tags }, null, 2), 'utf8');
    fs.renameSync(tempPath, DATA_PATH);
    return true;
  } catch (err) {
    logger.warn(`Could not write ${DATA_PATH}: ${err.message}`);
    return false;
  }
}

/** Every known tag, in display order. */
function loadTags() {
  return _read();
}

/**
 * Canonical spelling of `tag` if it is known, otherwise null.
 * @param {string|null|undefined} tag
 * @returns {string|null}
 */
function resolveTag(tag) {
  const key = String(tag ?? '').trim().toLowerCase();
  if (!key) return null;
  return _read().find(t => t.toLowerCase() === key) ?? null;
}

/**
 * Tags matching a partial input, for slash-command autocomplete.
 * @param {string} current - what the user has typed so far
 * @param {number} [limit] - Discord allows at most 25 choices
 * @returns {string[]}
 */
function searchTags(current, limit = 25) {
  const needle = String(current ?? '').trim().toLowerCase();
  const matches = needle
    ? _read().filter(t => t.toLowerCase().includes(needle))
    : _read();
  return matches.slice(0, Math.max(0, limit));
}

/**
 * Validates and appends a tag.
 * @param {string} tag
 * @returns {{ ok: boolean, tag?: string, reason?: string }}
 */
function addTag(tag) {
  const clean = String(tag ?? '').trim();
  if (!clean) return { ok: false, reason: 'Tag cannot be empty.' };
  if (/[[\]]/.test(clean)) return { ok: false, reason: 'Tag cannot contain `[` or `]`.' };
  if (clean.length > MAX_TAG_LENGTH) {
    return { ok: false, reason: `Tag must be ${MAX_TAG_LENGTH} characters or fewer.` };
  }

  const tags = _read();
  const existing = tags.find(t => t.toLowerCase() === clean.toLowerCase());
  if (existing) return { ok: false, reason: `\`${existing}\` is already in the list.` };

  tags.push(clean);
  if (!_write(tags)) return { ok: false, reason: 'Could not save the tag list — check the data directory.' };
  return { ok: true, tag: clean };
}

/**
 * Removes a tag from the list. Nicknames and roles are left untouched.
 * @param {string} tag
 * @returns {{ ok: boolean, tag?: string, reason?: string }}
 */
function removeTag(tag) {
  const canonical = resolveTag(tag);
  if (!canonical) return { ok: false, reason: `\`${String(tag ?? '').trim()}\` is not in the list.` };

  const remaining = _read().filter(t => t !== canonical);
  if (!_write(remaining)) return { ok: false, reason: 'Could not save the tag list — check the data directory.' };
  return { ok: true, tag: canonical };
}

module.exports = { loadTags, resolveTag, searchTags, addTag, removeTag, DATA_PATH };
