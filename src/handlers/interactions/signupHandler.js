// @ts-check
/**
 * signupHandler.js — Per-clan RaidHelper signups under one permanent category.
 *
 * One channel per clan tag (visible only to the guild role named exactly like
 * the tag) plus a public solo channel; each match day gets one RaidHelper
 * event per channel, created via the RaidHelper API (`utils/raidhelper.js`).
 * Posting is idempotent through `utils/signupStore.js`, so the daily
 * scheduler tick and the panel's "Post now" can never double-post.
 *
 * Entry points: the panel's Signups sub-panel (opened from the Panel utils
 * dropdown — the main panel already uses all five component rows) and
 * `autoPostSignups()` called by the scheduler.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const logger = require('../../utils/logger');
const { COLORS } = require('../../config/theme');
const { loadTags } = require('../../utils/tagStore');
const store = require('../../utils/signupStore');
const raidhelper = require('../../utils/raidhelper');
const { warsawDateParts } = require('../../utils/warsawTime');
const { sendLog } = require('./shared');

const SOLO_KEY = store.SOLO_KEY;
const SOLO_CHANNEL_NAME = 'signup-solo';
const DEFAULT_CATEGORY_NAME = 'MWF Signups';
// The guild's custom "Solo Signup" RaidHelper template (Commander/Infantry/
// Tank/Recon/Artillery classes). Clan events use the same template but
// suppress its `temp_role` ("Solo Signup") via advancedSettings; the solo
// event keeps it. Note: numeric ids address RaidHelper's built-in templates —
// guild custom templates need the `ct` prefix.
const DEFAULT_CLAN_TEMPLATE = 'ct21';
const DEFAULT_SOLO_TEMPLATE = 'ct21';

// Event time is the briefing (match start is +30 min, see the description).
const DEFAULT_EVENT_TIME = '19:30';

// Description and per-event overrides mirrored from the guild's existing
// scheduled "Midweek Frontline - Solo Signup" events, so API-created events
// render identically: schedule block, 2-hour duration, brand color, hidden
// leader flag, and the Bench/Late/Tentative/Absence buttons hidden (that is
// what the blank emote id does). `{eventtime…}` placeholders resolve per event.
// The single-signups disclaimer only makes sense on the solo event.
const SIGNUP_DESCRIPTION = [
  '### Schedule:',
  ':alarm_clock: **Briefing** - **<t:{eventtime#unix}:t>**',
  ':arrow_right: **Start** - **<t:{eventtime+30#unix}:t>**',
].join('\n');

const SOLO_DESCRIPTION = [
  SIGNUP_DESCRIPTION,
  '',
  '### Disclaimer:',
  'Single signups are welcome, but **full squads** will be **prioritized**.',
].join('\n');

const HIDDEN_BUTTON_EMOTE = '782549546210951188';

function baseAdvancedSettings() {
  return {
    create_discordevent: false,
    duration: 120,
    deletion: '0',
    color: '#011327',
    show_leader: false,
    show_on_overview: false,
    show_extra_specs: false,
    spec_saving: false,
    apply_unregister: true,
    apply_specreset: false,
    lock_at_limit: false,
    bench_overflow: false,
    font_style: 'none',
    tp_deletion: '0',
    tentative_emote: HIDDEN_BUTTON_EMOTE,
    late_emote: HIDDEN_BUTTON_EMOTE,
    bench_emote: HIDDEN_BUTTON_EMOTE,
    absence_emote: HIDDEN_BUTTON_EMOTE,
    specreset_emote: HIDDEN_BUTTON_EMOTE,
  };
}

/** Briefing time (24h HH:MM Warsaw) the events are created with. */
function signupEventTime() {
  const value = String(process.env.SIGNUP_EVENT_TIME || DEFAULT_EVENT_TIME).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_EVENT_TIME;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Channel name for a clan tag: `signup-<slug>`.
 * @param {string} tag
 */
function signupChannelName(tag) {
  const slug = String(tag).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `signup-${slug || 'clan'}`;
}

/**
 * The next match day on the Europe/Warsaw calendar (default Wednesday,
 * override via SIGNUP_MATCH_DAY 0=Sun…6=Sat). On the match day itself it
 * keeps pointing at today until the event time has passed, then rolls a week.
 * @param {Date} [now]
 * @returns {{ date: string, year: number, month: number, day: number, unixDay: number }}
 */
function nextMatchDate(now = new Date()) {
  const matchDay = Number.parseInt(process.env.SIGNUP_MATCH_DAY ?? '3', 10);
  const day = Number.isInteger(matchDay) && matchDay >= 0 && matchDay <= 6 ? matchDay : 3;
  const [eventHour, eventMinute] = signupEventTime().split(':').map(Number);

  const parts = warsawDateParts(now);
  let daysAhead = (day - parts.weekday + 7) % 7;
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (daysAhead === 0 && nowMinutes > eventHour * 60 + eventMinute) daysAhead = 7;

  // Date.UTC normalizes day overflow (e.g. day 32 -> next month).
  const target = new Date(Date.UTC(parts.year, parts.month, parts.day + daysAhead));
  const t = warsawDateParts(target);
  const iso = `${t.year}-${String(t.month + 1).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  return { date: iso, year: t.year, month: t.month, day: t.day, unixDay: Math.floor(target.getTime() / 1000) };
}

function categoryName() {
  return (process.env.SIGNUP_CATEGORY_NAME || DEFAULT_CATEGORY_NAME).trim() || DEFAULT_CATEGORY_NAME;
}

// ── Structure: category + channels ───────────────────────────────────────────

/**
 * Overwrites for a private signup channel: hidden from @everyone, visible to
 * one role, always accessible to this bot and to RaidHelper's bot (which
 * needs an explicit allow or it can neither post the event nor serve the
 * signup buttons). Every overwrite carries an explicit `type`: the ids are
 * raw snowflakes, and discord.js refuses to guess user-vs-role for ids it
 * has not cached (the RaidHelper bot member usually is not).
 * @param {import('discord.js').Guild} guild
 * @param {string|undefined} allowRoleId
 */
function privateChannelOverwrites(guild, allowRoleId) {
  const rhBotId = process.env.RAIDHELPER_BOT_ID;
  const overwrites = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.members.me?.id ?? guild.client.user.id,
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    },
  ];
  if (allowRoleId) {
    overwrites.push({ id: allowRoleId, type: OverwriteType.Role, allow: [PermissionFlagsBits.ViewChannel] });
  }
  if (rhBotId) {
    overwrites.push({
      id: rhBotId,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  return overwrites;
}

/**
 * Overwrites for a clan's channel. The clan role is matched by name (same
 * convention as tagHandler.syncTagRoles).
 * @param {import('discord.js').Guild} guild
 * @param {string} tag
 * @returns {{ overwrites: Array<Object>, warning: string|null }}
 */
function clanOverwrites(guild, tag) {
  const role = guild.roles.cache.find(r => r.name === tag);
  let warning = null;
  if (!role) warning = `No role named \`${tag}\` — channel is admin-only until the role exists.`;
  else if (!process.env.RAIDHELPER_BOT_ID) warning = 'RAIDHELPER_BOT_ID is not set — RaidHelper may not see the private channels.';
  return { overwrites: privateChannelOverwrites(guild, role?.id), warning };
}

/**
 * Overwrites for the solo channel: visible to everyone who has linked their
 * PlayerID (the role the register bot grants, SIGNUP_SOLO_ROLE_ID). Unset
 * means the channel stays public.
 * @param {import('discord.js').Guild} guild
 * @returns {{ overwrites: Array<Object>|undefined, warning: string|null }}
 */
function soloOverwrites(guild) {
  const roleId = (process.env.SIGNUP_SOLO_ROLE_ID || '').trim();
  if (!roleId) {
    return { overwrites: undefined, warning: 'SIGNUP_SOLO_ROLE_ID is not set — #signup-solo is visible to everyone.' };
  }
  if (!guild.roles.cache.get(roleId)) {
    return { overwrites: undefined, warning: `SIGNUP_SOLO_ROLE_ID role ${roleId} not found — leaving #signup-solo permissions unchanged.` };
  }
  return { overwrites: privateChannelOverwrites(guild, roleId), warning: null };
}

/**
 * Finds or creates the signup category and one channel per clan tag plus the
 * solo channel. Never deletes anything — a removed tag just leaves its
 * channel behind for the admins to archive. With `applyOverwrites` (the
 * panel's "Sync channels"), permission overwrites are re-applied to existing
 * channels too, so role/config changes propagate; plain posting only sets
 * them on newly created channels.
 * @param {import('discord.js').Guild} guild
 * @param {{ applyOverwrites?: boolean }} [opts]
 * @returns {Promise<{ category: import('discord.js').CategoryChannel,
 *                     channels: Map<string, import('discord.js').TextChannel>,
 *                     created: string[], warnings: string[] }>}
 */
async function ensureStructure(guild, { applyOverwrites = false } = {}) {
  const state = store.getState();
  const created = [];
  const warnings = [];

  await guild.channels.fetch();

  // Category: stored id → by name → create.
  let category = state.category_id ? guild.channels.cache.get(state.category_id) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName().toLowerCase()
    ) ?? null;
  }
  if (!category) {
    category = await guild.channels.create({ name: categoryName(), type: ChannelType.GuildCategory });
    created.push(`category ${category.name}`);
  }
  if (state.category_id !== category.id) store.setCategoryId(category.id);

  /** @type {Map<string, import('discord.js').TextChannel>} */
  const channels = new Map();

  /**
   * @param {string} key store key (tag or SOLO_KEY)
   * @param {string} name wanted channel name
   * @param {Array<Object>|undefined} overwrites undefined = inherit (public)
   */
  const ensureChannel = async (key, name, overwrites) => {
    const storedId = store.getState().channels[key];
    let channel = storedId ? guild.channels.cache.get(storedId) : null;
    if (!channel || channel.type !== ChannelType.GuildText) {
      channel = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && c.parentId === category.id && c.name === name
      ) ?? null;
    }
    if (!channel) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.id,
        ...(overwrites ? { permissionOverwrites: overwrites } : {}),
      });
      created.push(`#${name}`);
    } else if (applyOverwrites && overwrites) {
      try {
        await /** @type {import('discord.js').TextChannel} */ (channel).permissionOverwrites.set(overwrites);
      } catch (err) {
        warnings.push(`#${name}: could not update permissions (${err.message})`);
      }
    }
    if (store.getState().channels[key] !== channel.id) store.setChannel(key, channel.id);
    channels.set(key, /** @type {import('discord.js').TextChannel} */ (channel));
  };

  for (const tag of loadTags()) {
    const { overwrites, warning } = clanOverwrites(guild, tag);
    if (warning) warnings.push(`${tag}: ${warning}`);
    await ensureChannel(tag, signupChannelName(tag), overwrites);
  }
  const solo = soloOverwrites(guild);
  if (solo.warning) warnings.push(`solo: ${solo.warning}`);
  await ensureChannel(SOLO_KEY, SOLO_CHANNEL_NAME, solo.overwrites);

  return { category: /** @type {*} */ (category), channels, created, warnings };
}

// ── Posting / cancelling events ──────────────────────────────────────────────

/**
 * Creates the RaidHelper events for a match date in every signup channel that
 * doesn't have one recorded yet.
 * @param {import('discord.js').Guild} guild
 * @param {{ date: string }} match - from nextMatchDate()
 * @param {{ leaderId: string }} opts
 * @returns {Promise<{ results: Array<{key: string, label: string, status: string, detail?: string}>,
 *                     created: string[], warnings: string[] }>}
 */
async function postSignups(guild, match, { leaderId }) {
  const { channels, created, warnings } = await ensureStructure(guild);
  const time = signupEventTime();
  const results = [];

  for (const [key, channel] of channels) {
    const isSolo = key === SOLO_KEY;
    const label = isSolo ? 'Solo' : key;
    if (store.getEvent(match.date, key)) {
      results.push({ key, label, status: 'skipped' });
      continue;
    }
    try {
      const event = await raidhelper.createEvent({
        serverId: guild.id,
        channelId: channel.id,
        leaderId,
        templateId: isSolo
          ? (process.env.RAIDHELPER_SOLO_TEMPLATE_ID || DEFAULT_SOLO_TEMPLATE)
          : (process.env.RAIDHELPER_TEMPLATE_ID || DEFAULT_CLAN_TEMPLATE),
        date: match.date,
        time,
        title: `Midweek Frontline — ${label}`,
        description: isSolo ? SOLO_DESCRIPTION : SIGNUP_DESCRIPTION,
        // Mirror the scheduled solo events' rendering; clan events also drop
        // the template's temp_role (the "Solo Signup" role) — only the solo
        // event grants it — and the solo event links its voice channel.
        advancedSettings: isSolo
          ? {
            ...baseAdvancedSettings(),
            ...(process.env.SIGNUP_SOLO_VOICE_CHANNEL
              ? { voice_channel: process.env.SIGNUP_SOLO_VOICE_CHANNEL }
              : {}),
          }
          : { ...baseAdvancedSettings(), temp_role: false },
      });
      store.recordEvent(match.date, key, { id: event.id, channelId: channel.id });
      results.push({ key, label, status: 'created' });
    } catch (err) {
      logger.warn(`Signup event for ${label} failed: ${err.message}`);
      results.push({ key, label, status: 'failed', detail: err.message });
    }
  }
  return { results, created, warnings };
}

/**
 * Deletes every recorded event for a match date.
 * @param {string} date
 * @returns {Promise<Array<{key: string, status: string, detail?: string}>>}
 */
async function cancelSignups(date) {
  const events = store.eventsForDate(date);
  const results = [];
  for (const [key, event] of Object.entries(events)) {
    try {
      await raidhelper.deleteEvent(event.id);
      store.clearEvent(date, key);
      results.push({ key, status: 'deleted' });
    } catch (err) {
      logger.warn(`Deleting signup event ${event.id} (${key}) failed: ${err.message}`);
      results.push({ key, status: 'failed', detail: err.message });
    }
  }
  return results;
}

// ── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Whether the daily tick should post now: auto-post on, the next match date
 * within SIGNUP_LEAD_DAYS (default 7), and at least one channel un-posted.
 * Exposed for tests.
 * @param {Date} [now]
 */
function autoPostDue(now = new Date()) {
  if (!store.getState().auto_post) return { due: false, reason: 'auto-post is off' };
  const match = nextMatchDate(now);
  const leadDays = Number.parseInt(process.env.SIGNUP_LEAD_DAYS ?? '7', 10);
  const lead = Number.isInteger(leadDays) && leadDays >= 0 ? leadDays : 7;
  const daysUntil = Math.round((match.unixDay - now.getTime() / 1000) / 86400);
  if (daysUntil > lead) return { due: false, reason: `match ${match.date} is ${daysUntil}d away (lead ${lead}d)` };

  const posted = store.eventsForDate(match.date);
  const wanted = [...loadTags(), SOLO_KEY];
  if (wanted.every(key => posted[key])) return { due: false, reason: `all ${wanted.length} events for ${match.date} already posted` };
  return { due: true, match };
}

/**
 * The daily scheduler tick: posts the next match's signups when due.
 * Leader is SIGNUP_LEADER_ID or the bot itself (the API accepts a bot id).
 * @param {import('discord.js').Client} client
 */
async function autoPostSignups(client) {
  const check = autoPostDue();
  if (!check.due) return { ok: true, skipped: check.reason };

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return { ok: false, reason: 'guild not found' };

  const leaderId = process.env.SIGNUP_LEADER_ID || client.user?.id;
  const { results, created, warnings } = await postSignups(guild, check.match, { leaderId });

  const createdEvents = results.filter(r => r.status === 'created');
  const failed = results.filter(r => r.status === 'failed');
  logger.info(`Signup auto-post for ${check.match.date}: ${createdEvents.length} created, ${failed.length} failed`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📅 Signups Auto-Posted')
    .setDescription(resultLines(results, created, warnings).join('\n'))
    .addFields({ name: 'Match', value: check.match.date, inline: true })
    .setTimestamp();
  await sendLog(client, embed);

  return { ok: true, results };
}

// ── Panel sub-panel UI ───────────────────────────────────────────────────────

const STATUS_ICON = { created: '🟢', skipped: '⚪', deleted: '🗑️', failed: '🔴' };

/**
 * @param {Array<{label?: string, key: string, status: string, detail?: string}>} results
 * @param {string[]} [created] @param {string[]} [warnings]
 */
function resultLines(results, created = [], warnings = []) {
  const lines = results.map(r =>
    `${STATUS_ICON[r.status] ?? '❔'} **${r.label ?? r.key}** — ${r.status}${r.detail ? ` (${r.detail.slice(0, 80)})` : ''}`
  );
  if (created.length) lines.push(`🆕 Created: ${created.join(', ')}`);
  for (const w of warnings) lines.push(`⚠️ ${w}`);
  return lines.length ? lines : ['_nothing to do_'];
}

/**
 * The Signups sub-panel payload: status embed + its own action dropdown.
 * (Opened from the main panel, which already uses all 5 component rows.)
 * @param {import('discord.js').Guild|null} guild
 * @param {string[]} [extraLines] appended action results
 */
function buildSignupsPayload(guild, extraLines = []) {
  const state = store.getState();
  const match = nextMatchDate();
  const tags = loadTags();
  const wanted = [...tags, SOLO_KEY];
  const posted = store.eventsForDate(match.date);
  const postedCount = wanted.filter(key => posted[key]).length;

  const category = state.category_id && guild ? guild.channels.cache.get(state.category_id) : null;

  const rows = [
    `📅 **Next match**   ${match.date}, briefing ${signupEventTime()}`,
    `📮 **Posted**   ${postedCount}/${wanted.length} (${tags.length} clans + solo)`,
    `🔁 **Auto-post**   ${state.auto_post ? '🟢 on (daily check)' : '🔴 off'}`,
    `🗂️ **Category**   ${category ? `🟢 ${category.name}` : '🔴 not created yet'}`,
    `🏷️ **Clans**   ${tags.length ? tags.join(', ') : '— none (add tags first)'}`,
  ];
  if (!process.env.RAIDHELPER_API_KEY) rows.push('⚠️ `RAIDHELPER_API_KEY` is not set — posting will fail.');
  if (!process.env.RAIDHELPER_BOT_ID) rows.push('⚠️ `RAIDHELPER_BOT_ID` is not set — RaidHelper may not see private channels.');
  if (extraLines.length) rows.push('', ...extraLines);

  const embed = new EmbedBuilder()
    .setTitle('📅  Signups')
    .setColor(COLORS.primary)
    .setDescription(rows.join('\n'));

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_signups_select')
      .setPlaceholder('📅  Signups — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('post')
          .setLabel('Post signups now')
          .setDescription(`Create the RaidHelper events for ${match.date}.`)
          .setEmoji('📮'),
        new StringSelectMenuOptionBuilder()
          .setValue('sync')
          .setLabel('Sync channels')
          .setDescription('Create missing category/channels for the current tag list.')
          .setEmoji('🔧'),
        new StringSelectMenuOptionBuilder()
          .setValue('toggle')
          .setLabel(state.auto_post ? 'Disable auto-post' : 'Enable auto-post')
          .setDescription('Daily check posts the next match automatically.')
          .setEmoji(state.auto_post ? '⏸️' : '▶️'),
        new StringSelectMenuOptionBuilder()
          .setValue('cancel')
          .setLabel('Cancel next match signups')
          .setDescription(`Delete the posted events for ${match.date}.`)
          .setEmoji('🗑️'),
        new StringSelectMenuOptionBuilder()
          .setValue('refresh')
          .setLabel('Refresh')
          .setDescription('Re-read the signup status.')
          .setEmoji('🔄')
      )
  );

  return { embeds: [embed], components: [menu] };
}

/** Panel row for the main /panel embed (null keeps the panel clean when unconfigured). */
function signupsPanelRow() {
  if (!process.env.RAIDHELPER_API_KEY) return null;
  const state = store.getState();
  const match = nextMatchDate();
  const wanted = [...loadTags(), SOLO_KEY];
  const posted = store.eventsForDate(match.date);
  const postedCount = wanted.filter(key => posted[key]).length;
  const icon = postedCount === 0 ? '🔴' : postedCount === wanted.length ? '🟢' : '🟡';
  const auto = state.auto_post ? 'auto' : 'manual';
  return `📅 **Signups**   ${icon}   _${match.date} · ${postedCount}/${wanted.length} posted · ${auto}_`;
}

// ── Interaction handlers (wired in interactionCreate.js) ────────────────────

/** Opens the Signups sub-panel (from the main panel's Panel utils menu). */
async function handleAdminSignupsOpen(interaction) {
  return interaction.reply({ ...buildSignupsPayload(interaction.guild), flags: MessageFlags.Ephemeral });
}

async function handleAdminSignupsRefresh(interaction) {
  return interaction.update(buildSignupsPayload(interaction.guild));
}

async function handleAdminSignupsPost(interaction) {
  await interaction.deferUpdate();
  const match = nextMatchDate();
  // Leader is the bot (or SIGNUP_LEADER_ID), not the clicking admin —
  // RaidHelper DMs the leader an "event was created!" note per event, which
  // with one event per clan would flood a human leader's DMs.
  const { results, created, warnings } = await postSignups(interaction.guild, match, {
    leaderId: process.env.SIGNUP_LEADER_ID || interaction.client.user.id,
  });
  await interaction.editReply(
    buildSignupsPayload(interaction.guild, [`**Post for ${match.date}:**`, ...resultLines(results, created, warnings)])
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📅 Signups Posted')
    .setDescription(resultLines(results, created, warnings).join('\n'))
    .addFields(
      { name: '👤 Admin', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Match', value: match.date, inline: true }
    )
    .setTimestamp();
  await sendLog(interaction.client, embed);
}

async function handleAdminSignupsSync(interaction) {
  await interaction.deferUpdate();
  const { created, warnings } = await ensureStructure(interaction.guild, { applyOverwrites: true });
  const lines = created.length ? [`🆕 Created: ${created.join(', ')}`] : ['✅ Structure is up to date.'];
  for (const w of warnings) lines.push(`⚠️ ${w}`);
  await interaction.editReply(buildSignupsPayload(interaction.guild, lines));
}

async function handleAdminSignupsToggle(interaction) {
  const next = !store.getState().auto_post;
  store.setAutoPost(next);
  return interaction.update(
    buildSignupsPayload(interaction.guild, [next ? '▶️ Auto-post **enabled**.' : '⏸️ Auto-post **disabled**.'])
  );
}

/** Ephemeral confirm before deleting posted events (destructive). */
async function handleAdminSignupsCancelConfirm(interaction) {
  const match = nextMatchDate();
  const posted = Object.keys(store.eventsForDate(match.date)).length;
  if (!posted) {
    return interaction.update(buildSignupsPayload(interaction.guild, [`⚪ Nothing posted for ${match.date}.`]));
  }
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚠️ Cancel Signups')
    .setDescription(`This deletes **${posted}** RaidHelper event(s) for **${match.date}** — signups on them are lost.\n\nAre you sure?`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_signups_cancel_confirm').setLabel('Delete events').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_signups_cancel_cancel').setLabel('Keep them').setStyle(ButtonStyle.Secondary)
  );
  return interaction.update({ embeds: [embed], components: [row] });
}

async function handleAdminSignupsCancel(interaction) {
  await interaction.deferUpdate();
  const match = nextMatchDate();
  const results = await cancelSignups(match.date);
  await interaction.editReply(
    buildSignupsPayload(interaction.guild, [`**Cancelled ${match.date}:**`, ...resultLines(results)])
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🗑️ Signups Cancelled')
    .setDescription(resultLines(results).join('\n'))
    .addFields(
      { name: '👤 Admin', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Match', value: match.date, inline: true }
    )
    .setTimestamp();
  await sendLog(interaction.client, embed);
}

async function handleAdminSignupsCancelCancel(interaction) {
  return interaction.update(buildSignupsPayload(interaction.guild, ['Cancelled — the events stay up.']));
}

module.exports = {
  // pure/testable
  signupChannelName,
  nextMatchDate,
  autoPostDue,
  SOLO_KEY,
  // core
  ensureStructure,
  postSignups,
  cancelSignups,
  autoPostSignups,
  // panel
  signupsPanelRow,
  buildSignupsPayload,
  handleAdminSignupsOpen,
  handleAdminSignupsRefresh,
  handleAdminSignupsPost,
  handleAdminSignupsSync,
  handleAdminSignupsToggle,
  handleAdminSignupsCancelConfirm,
  handleAdminSignupsCancel,
  handleAdminSignupsCancelCancel,
};
