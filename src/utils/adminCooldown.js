/**
 * adminCooldown.js — per-user, per-action cooldown for destructive admin
 * controls (e.g. Reset Roles, Clear Log Channel). Clears on process restart.
 */

const DEFAULT_COOLDOWN_SECONDS = 10;

function cooldownSeconds() {
  const raw = parseInt(process.env.ADMIN_DESTRUCTIVE_COOLDOWN_SECONDS ?? String(DEFAULT_COOLDOWN_SECONDS), 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_COOLDOWN_SECONDS;
}

const store = new Map(); // key: `${userId}:${action}` → timestamp ms

function _key(userId, action) {
  return `${userId}:${action}`;
}

/**
 * Returns remaining seconds if the user is still cooling down, or 0 if they
 * may proceed. Does NOT mark the action — caller is responsible for calling
 * `markAdminAction` after actually running the destructive work.
 */
function remainingCooldown(userId, action) {
  const cd = cooldownSeconds();
  if (cd <= 0) return 0;
  const last = store.get(_key(userId, action)) ?? 0;
  const elapsed = Math.floor((Date.now() - last) / 1000);
  return elapsed >= cd ? 0 : cd - elapsed;
}

function markAdminAction(userId, action) {
  store.set(_key(userId, action), Date.now());
}

module.exports = { remainingCooldown, markAdminAction };
