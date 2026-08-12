// @ts-check
/**
 * raidhelper.js — Minimal RaidHelper API client (event create/delete).
 *
 * Verified against the live API (2026-08): events are created with
 * `POST /api/v4/servers/{serverId}/channels/{channelId}/event` and removed
 * with `DELETE /api/v4/events/{eventId}`. Auth is the raw API key in the
 * `Authorization` header (no `Bearer` prefix) — the key comes from `/apikey`
 * in the Discord server. A bot user id is accepted as `leaderId`, which is
 * what lets the scheduler post events without a human trigger.
 */

const API_BASE = 'https://raid-helper.dev/api/v4';

class RaidHelperError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status) {
    super(message);
    this.name = 'RaidHelperError';
    this.status = status;
  }
}

function _apiKey() {
  const key = process.env.RAIDHELPER_API_KEY;
  if (!key) throw new RaidHelperError('RAIDHELPER_API_KEY is not set');
  return key;
}

// The API allows 10 requests per 5 seconds; with one event per clan a post or
// cancel run makes 30+ calls, so every request goes through one serialized,
// paced queue, and a 429 that slips through anyway is retried after the wait
// the API asks for.
const MIN_REQUEST_INTERVAL_MS = 550;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_WAIT_MS = 5000;

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let _queue = Promise.resolve();
let _lastRequestAt = 0;

/** Milliseconds to wait, parsed from e.g. `"Try again in 3.2s"` (null = no hint). */
function _retryAfterMs(body) {
  const m = /try again in\s*(\d+(?:\.\d+)?)\s*s/i.exec(body || '');
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

/**
 * @param {string} url
 * @param {RequestInit} init
 */
function _request(url, init) {
  const run = _queue.then(() => _pacedRequest(url, init));
  _queue = run.catch(() => {}); // one failure must not wedge the queue
  return run;
}

async function _pacedRequest(url, init) {
  for (let attempt = 0; ; attempt++) {
    const wait = _lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await _sleep(wait);
    _lastRequestAt = Date.now();

    const res = await fetch(url, {
      ...init,
      headers: { Authorization: _apiKey(), 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const body = await res.text();

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await _sleep(_retryAfterMs(body) ?? DEFAULT_RETRY_WAIT_MS);
      continue;
    }
    if (!res.ok) {
      throw new RaidHelperError(`RaidHelper ${init.method} ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    try {
      return body ? JSON.parse(body) : {};
    } catch (_) {
      // Some endpoints answer with plain text on success (e.g. deletes).
      return { raw: body };
    }
  }
}

/**
 * Creates a signup event in a channel.
 * @param {{ serverId: string, channelId: string, leaderId: string,
 *           templateId?: string, date: string, time: string,
 *           title?: string, description?: string,
 *           advancedSettings?: Record<string, unknown> }} opts
 *   `date` is `YYYY-MM-DD`, `time` is 24h `HH:MM` (both server-local as
 *   configured in RaidHelper — matches the guild's Warsaw event times).
 *   `advancedSettings` entries override the template's (verified live:
 *   e.g. `{create_discordevent: false}` sticks on the created event).
 * @returns {Promise<{ id: string } & Record<string, any>>} the created event
 */
async function createEvent(opts) {
  const { serverId, channelId, leaderId, templateId, date, time, title, description, advancedSettings } = opts;
  const body = { leaderId, date, time };
  if (templateId) body.templateId = String(templateId);
  if (title) body.title = title;
  if (description) body.description = description;
  if (advancedSettings) body.advancedSettings = advancedSettings;

  const data = await _request(`${API_BASE}/servers/${serverId}/channels/${channelId}/event`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const event = data?.event ?? data;
  if (!event?.id) throw new RaidHelperError(`RaidHelper create returned no event id: ${JSON.stringify(data).slice(0, 200)}`);
  return event;
}

/**
 * Deletes an event by id. Missing events (already deleted by hand) are
 * treated as success so cancel flows stay idempotent.
 * @param {string} eventId
 */
async function deleteEvent(eventId) {
  try {
    await _request(`${API_BASE}/events/${eventId}`, { method: 'DELETE' });
    return true;
  } catch (err) {
    if (err instanceof RaidHelperError && err.status === 404) return true;
    throw err;
  }
}

module.exports = { createEvent, deleteEvent, RaidHelperError, API_BASE };
