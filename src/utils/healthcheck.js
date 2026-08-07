/**
 * healthcheck.js — Runs probes against the live Discord state and returns a
 * structured report for the admin panel.
 *
 * Design goals:
 *   • Only flag things the admin can actually act on.
 *   • Silently self-heal stale pointers (cache rows whose Discord message
 *     got deleted) — the panel status row already shows 🔴 for those, and
 *     a stale pointer is purely cosmetic once cleared.
 *   • Each issue carries a short `hint` the admin can follow.
 *
 * Checks:
 *   1. Required env vars are set.
 *   2. Every configured channel resolves and the bot has View + Send + Embed
 *      Links on it (Manage Messages on the log channel).
 *   3. Bot has guild-level `Manage Roles` (needed for Reset Roles and faction
 *      swaps).
 *   4. Each faction role exists AND the bot's highest role sits above it —
 *      otherwise Discord rejects role add/remove even with Manage Roles.
 *   5. Stale cache self-heal: drop any Lineup/Server/Rotation cache entry
 *      whose referenced Discord message no longer exists, and report how
 *      many entries were cleared (info-level, not a failure).
 */

const { PermissionFlagsBits } = require('discord.js');
const {
  loadLineupData,
  clearLineupData,
  loadServerData,
  clearServerData,
} = require('./lineupStore');
const { loadRotationMsgId, clearRotationMsgId } = require('./rotationStore');
const { FACTIONS } = require('../config/factions');

const REQUIRED_ENV_VARS = [
  'GUILD_ID',
  'FACTION_CHANNEL',
  'LINEUP_CHANNEL',
  'SERVER_DETAILS_CHANNEL',
  'MAP_ROTATION_CHANNEL',
  'NODES_CHANNELS',
];

const CHANNEL_CHECKS = [
  { envVar: 'FACTION_CHANNEL',        label: 'Faction',        needsManage: false, multiple: false },
  { envVar: 'LINEUP_CHANNEL',         label: 'Lineup',         needsManage: false, multiple: false },
  { envVar: 'SERVER_DETAILS_CHANNEL', label: 'Server Details', needsManage: false, multiple: false },
  { envVar: 'MAP_ROTATION_CHANNEL',   label: 'Map Rotation',   needsManage: false, multiple: false },
  { envVar: 'NODES_CHANNELS',         label: 'Nodes',          needsManage: false, multiple: true  },
  { envVar: 'ADMIN_LOG_CHANNEL',      label: 'Admin Logs',     needsManage: true,  multiple: false, optional: true },
];

function permName(flag) {
  for (const [k, v] of Object.entries(PermissionFlagsBits)) {
    if (v === flag) return k;
  }
  return 'Unknown';
}

function baseChannelPerms(needsManage) {
  // ReadMessageHistory is required for channel.messages.fetch(messageId),
  // which every Edit/Apply flow uses to locate the existing embed before
  // updating it. AttachFiles is required for Lineup caption edits that
  // repost the lineup image via attachment://.
  const perms = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
  ];
  if (needsManage) perms.push(PermissionFlagsBits.ManageMessages);
  return perms;
}

async function checkChannelAccess(client, channelId, needsManage) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return { ok: false, reason: 'channel not found' };
    const me = channel.guild?.members?.me ?? null;
    if (!me) return { ok: true };
    const perms = channel.permissionsFor(me);
    if (!perms) return { ok: false, reason: 'permissions unavailable' };
    const missing = baseChannelPerms(needsManage).filter(p => !perms.has(p));
    if (missing.length) {
      return { ok: false, reason: `missing perms: ${missing.map(permName).join(', ')}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `fetch failed (${e.code ?? e.message})` };
  }
}

async function messageExists(client, channelId, messageId) {
  if (!channelId || !messageId) return null; // nothing to check
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return false;
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    return Boolean(msg);
  } catch (_) {
    return false;
  }
}

async function healStaleCache(client) {
  let cleared = 0;
  const lineupCh = process.env.LINEUP_CHANNEL;
  const serverCh = process.env.SERVER_DETAILS_CHANNEL;
  const rotationCh = process.env.MAP_ROTATION_CHANNEL;

  if (lineupCh) {
    for (const s of ['S1', 'S2']) {
      const data = loadLineupData(lineupCh, s);
      if (!data?.messageId) continue;
      const exists = await messageExists(client, lineupCh, data.messageId);
      if (exists === false && clearLineupData(lineupCh, s)) cleared++;
    }
  }
  if (serverCh) {
    for (const s of ['S1', 'S2']) {
      const data = loadServerData(serverCh, s);
      if (!data?.messageId) continue;
      const exists = await messageExists(client, serverCh, data.messageId);
      if (exists === false && clearServerData(serverCh, s)) cleared++;
    }
  }
  if (rotationCh) {
    const msgId = loadRotationMsgId(rotationCh);
    if (msgId) {
      const exists = await messageExists(client, rotationCh, msgId);
      if (exists === false && clearRotationMsgId(rotationCh)) cleared++;
    }
  }
  return cleared;
}

/**
 * Runs every probe. Returns `{ passed, total, issues: [{ label, detail, hint }], notes: [string] }`.
 * `notes` is free-form informational output (e.g. "cleared 2 stale cache entries").
 */
async function runHealthcheck(client, guildId) {
  const issues = [];
  const notes = [];
  let total = 0;
  let passed = 0;

  // 1. Env vars
  for (const key of REQUIRED_ENV_VARS) {
    total++;
    const v = process.env[key];
    if (v && String(v).trim() !== '') {
      passed++;
    } else {
      issues.push({
        kind: 'env',
        key,
        label: `env: ${key}`,
        detail: 'missing or empty',
        hint: `set ${key} in .env and restart the bot`,
      });
    }
  }

  // 2. Channels + permissions
  const channelResults = await Promise.all(
    CHANNEL_CHECKS.flatMap(cfg => {
      const raw = process.env[cfg.envVar];
      if (!raw) {
        if (cfg.optional) return [];
        return [Promise.resolve({ cfg, channelId: null, result: { ok: false, reason: 'env not set' } })];
      }
      const ids = cfg.multiple
        ? raw.split(',').map(s => s.trim()).filter(Boolean)
        : [raw.trim()];
      return ids.map(async id => ({ cfg, channelId: id, result: await checkChannelAccess(client, id, cfg.needsManage) }));
    })
  );
  for (const { cfg, channelId, result } of channelResults) {
    total++;
    if (result.ok) {
      passed++;
    } else {
      const where = channelId ? ` <#${channelId}>` : '';
      const missingPerms = result.reason.startsWith('missing perms');
      issues.push({
        kind: missingPerms ? 'channel-perms' : 'channel-invalid',
        channelId,
        channelLabel: cfg.label,
        envVar: cfg.envVar,
        label: `channel: ${cfg.label}${where}`,
        detail: result.reason,
        hint: missingPerms
          ? 'grant the missing permissions to the bot on this channel'
          : 'verify the channel ID and that the bot is in the server',
      });
    }
  }

  // 3. Guild-level Manage Roles (needed for Reset Roles and faction swaps)
  let guild = null;
  try { guild = await client.guilds.fetch(guildId); } catch (_) { /* handled below */ }

  total++;
  if (!guild) {
    issues.push({
      kind: 'guild',
      label: 'guild',
      detail: 'guild unreachable',
      hint: 'check GUILD_ID and that the bot is still in the server',
    });
  } else {
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!me) {
      issues.push({
        kind: 'bot-member',
        label: 'guild: bot member',
        detail: 'could not fetch bot member',
        hint: 're-invite the bot with the `bot` + `applications.commands` scopes',
      });
    } else if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      issues.push({
        kind: 'manage-roles',
        label: 'guild: Manage Roles',
        detail: 'bot lacks Manage Roles permission',
        hint: 'grant Manage Roles in the server role settings — Reset Roles and faction swaps will fail without it',
      });
    } else {
      passed++;
    }
  }

  // 4. Faction roles exist + bot role above them
  const botHighest = guild?.members?.me?.roles?.highest ?? null;
  for (const faction of Object.values(FACTIONS)) {
    total++;
    const rid = process.env[faction.envVar];
    const prettyLabel = `role: ${faction.label}`;
    if (!rid) {
      issues.push({
        kind: 'env',
        key: faction.envVar,
        label: prettyLabel,
        detail: `${faction.envVar} not set`,
        hint: `set ${faction.envVar} to the Discord role ID in .env and restart`,
      });
      continue;
    }
    if (!guild) {
      issues.push({ kind: 'guild', label: prettyLabel, detail: 'guild unreachable', hint: 'see guild issue above' });
      continue;
    }
    const role = await guild.roles.fetch(rid).catch(() => null);
    if (!role) {
      issues.push({
        kind: 'role-missing',
        envVar: faction.envVar,
        roleId: rid,
        label: prettyLabel,
        detail: 'role not found',
        hint: `create the role and update ${faction.envVar} in .env (current: ${rid})`,
      });
      continue;
    }
    if (botHighest && botHighest.comparePositionTo(role) <= 0) {
      issues.push({
        kind: 'role-hierarchy',
        roleName: role.name,
        botRoleName: botHighest.name,
        label: prettyLabel,
        detail: `bot role (${botHighest.name}) is not above ${role.name}`,
        hint: 'move the bot role higher in the server role list — Discord rejects role add/remove when the bot sits at or below the target role',
      });
      continue;
    }
    passed++;
  }

  // 5. Stale cache self-heal (silent; reported as a note, not a failure)
  try {
    const cleared = await healStaleCache(client);
    if (cleared > 0) {
      notes.push(`cleared ${cleared} stale cache pointer(s) (message had been deleted on Discord)`);
    }
  } catch (_) { /* non-fatal */ }

  return { passed, total, issues, notes };
}

module.exports = { runHealthcheck };
