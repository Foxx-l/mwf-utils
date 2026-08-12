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

/**
 * @param {string} url
 * @param {RequestInit} init
 */
async function _request(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: _apiKey(), 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.text();
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

/**
 * Creates a signup event in a channel.
 * @param {{ serverId: string, channelId: string, leaderId: string,
 *           templateId?: string, date: string, time: string,
 *           title?: string, description?: string }} opts
 *   `date` is `YYYY-MM-DD`, `time` is 24h `HH:MM` (both server-local as
 *   configured in RaidHelper — matches the guild's Warsaw event times).
 * @returns {Promise<{ id: string } & Record<string, any>>} the created event
 */
async function createEvent(opts) {
  const { serverId, channelId, leaderId, templateId, date, time, title, description } = opts;
  const body = { leaderId, date, time };
  if (templateId) body.templateId = String(templateId);
  if (title) body.title = title;
  if (description) body.description = description;

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
