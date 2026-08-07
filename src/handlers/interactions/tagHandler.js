/**
 * tagHandler.js — Applies clan tags to nicknames and tag roles.
 *
 * Ported from the standalone TagSelector bot. The member-facing `/tag` command
 * and the admin `/tags set|clear` commands both go through applyTag(), so they
 * always produce the same nickname, the same role changes and the same audit
 * log entry.
 *
 * Nickname format is `[TAG] Name`. The existing `[...]` prefix is stripped
 * before a new one is applied, so switching tags never stacks prefixes. When
 * the result equals the member's account name the per-guild nickname is
 * cleared instead of set, keeping the member list free of redundant overrides.
 *
 * Tag roles are matched by role *name*: a guild role named like the tag is
 * granted and any other known-tag role is removed. Roles are never created or
 * deleted here, and role failures never fail the nickname change — they come
 * back as a `roleWarning` the caller can surface.
 */

const { EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { COLORS } = require('../../config/theme');
const { sendLog } = require('./shared');
const { loadTags } = require('../../utils/tagStore');
const { MAX_NICKNAME_LENGTH } = require('../../config/constants');

// Leading `[...]` plus any following whitespace, e.g. `[OKT] Fox` → `Fox`.
const TAG_PREFIX_PATTERN = /^\[[^\]]*\]\s*/;

// Discord: 50013 Missing Permissions — the bot is below the target's highest
// role, or the target is the guild owner (whose nickname nobody can change).
const MISSING_PERMISSIONS = 50013;

/**
 * Strips a leading `[TAG] ` prefix from a display name.
 * @param {string|null|undefined} name
 */
function stripTag(name) {
  return String(name ?? '').replace(TAG_PREFIX_PATTERN, '').trim();
}

/**
 * Builds `[TAG] Name`, truncated to Discord's nickname limit. The tag is never
 * cut — the name is.
 * @param {string} tag
 * @param {string} name
 */
function buildTaggedNick(tag, name) {
  const prefix = `[${tag}] `;
  const room = Math.max(0, MAX_NICKNAME_LENGTH - prefix.length);
  return `${prefix}${String(name ?? '').slice(0, room)}`.trim();
}

/**
 * Syncs tag roles for a member: drops every other known-tag role, grants the
 * role named like `tag` if one exists. Best effort.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} tag
 * @returns {Promise<{ roleName?: string, roleWarning?: string }>}
 */
async function syncTagRoles(member, tag) {
  const known = loadTags().map(t => t.toLowerCase());
  const target = tag
    ? member.guild.roles.cache.find(r => r.name.toLowerCase() === tag.toLowerCase()) ?? null
    : null;

  try {
    const stale = member.roles.cache.filter(r =>
      r.id !== target?.id && known.includes(r.name.toLowerCase()));
    if (stale.size) await member.roles.remove([...stale.keys()], 'Clan tag change');
    if (target && !member.roles.cache.has(target.id)) {
      await member.roles.add(target, 'Clan tag change');
    }
  } catch (err) {
    logger.warn(`Tag role sync failed for ${member.user.tag}: ${err.message}`);
    return { roleName: target?.name, roleWarning: 'Your nickname was updated, but I could not update the matching tag role. Ask an admin to check my role permissions and hierarchy.' };
  }

  return { roleName: target?.name };
}

/**
 * Applies (or clears) a member's clan tag.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} tag - canonical tag, or null to clear the tag
 * @param {{ actorTag?: string }} [opts] - `actorTag` names the admin who
 *        triggered the change; omit for self-service.
 * @returns {Promise<{ ok: boolean, reason?: string, unchanged?: boolean,
 *                     nickname?: string, roleName?: string, roleWarning?: string }>}
 */
async function applyTag(member, tag, opts = {}) {
  const natural = member.user.globalName || member.user.username;
  const base = stripTag(member.displayName) || natural;
  const previousNick = member.nickname ?? null;
  const previousName = previousNick ?? natural;

  const newNick = tag ? buildTaggedNick(tag, base) : base;
  // `null` removes the per-guild nickname entirely.
  const desired = newNick === natural ? null : newNick;

  if (desired === previousNick) {
    return { ok: true, unchanged: true, nickname: newNick };
  }

  try {
    await member.setNickname(desired, opts.actorTag ? `Clan tag by ${opts.actorTag}` : 'Clan tag update');
  } catch (err) {
    const reason = err?.code === MISSING_PERMISSIONS
      ? 'I am not allowed to change that nickname — the member has a role above mine, or is the server owner.'
      : `Discord rejected the nickname change: ${err.message}`;
    logger.warn(`Could not set nickname for ${member.user.tag}: ${err.message}`);
    return { ok: false, reason };
  }

  const { roleName, roleWarning } = await syncTagRoles(member, tag);

  logger.info(`${member.user.tag} tag ${tag ? `set to [${tag}]` : 'removed'}${opts.actorTag ? ` by ${opts.actorTag}` : ''}`);

  const logEmbed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(tag ? '🏷️ Clan Tag Set' : '🏷️ Clan Tag Removed')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: '👤 Member', value: `<@${member.id}>`, inline: true },
      { name: '🏷️ Tag', value: tag ? `\`${tag}\`` : '—', inline: true },
      { name: '🛠️ Changed by', value: opts.actorTag ?? 'self-service', inline: true },
      { name: '📝 Nickname', value: `\`${previousName}\` → \`${desired ?? natural}\`` },
    )
    .setTimestamp();
  sendLog(member.client, logEmbed).catch(() => {});

  return { ok: true, nickname: desired ?? natural, roleName, roleWarning };
}

module.exports = { applyTag, stripTag, buildTaggedNick, syncTagRoles, TAG_PREFIX_PATTERN };
