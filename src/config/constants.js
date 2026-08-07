// @ts-check
/**
 * Env-var requirements, in one place.
 * `startup`   — checked in src/index.js; the bot refuses to boot without them.
 * `healthcheck` — checked by utils/healthcheck.js; features they gate are
 *                 reported (with hints) rather than fatal.
 */
const REQUIRED_ENV_VARS = [
  'BOT_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'FACTION_CHANNEL',
  'ALLIES_ROLE',
  'AXIS_ROLE',
  'ALLIES_S2_ROLE',
  'AXIS_S2_ROLE',
];

const HEALTHCHECK_ENV_VARS = [
  'GUILD_ID',
  'FACTION_CHANNEL',
  'LINEUP_CHANNEL',
  'SERVER_DETAILS_CHANNEL',
  'MAP_ROTATION_CHANNEL',
  'NODES_CHANNELS',
];

module.exports = {
  REQUIRED_ENV_VARS,
  HEALTHCHECK_ENV_VARS,

  // Shared thumbnail used across all embeds.
  // Hosted from THIS repository's assets/ so the bot never depends on an
  // unrelated repo staying public.
  THUMBNAIL_URL: 'https://raw.githubusercontent.com/jemiel1/mwf-utils/main/assets/MWF.png',

  // Clan tags — the list migrated from the retired standalone TagSelector bot.
  // Only used to seed data/tags_data.json the first time the store is read (or
  // after the data volume is lost); `/tags add|remove` manages it from then on,
  // and the file always wins over this list.
  DEFAULT_CLAN_TAGS: [
    'OKT', 'TLL', '106', '331', '404', '57TH', '82AD', 'BFTB', 'BNKR', 'BSB',
    'BxB', 'CIRCLE', 'DD', 'DSS', 'EXD', 'GH', 'HTD', 'KRIEG', 'KSK', 'LCM',
    'MBYN', 'OMEN', 'OVER', 'PF', 'PZJR', 'RATZ', 'StDb', 'UKLL', 'VLK', 'WAR',
    'WCB', 'YOKO', 'PBS', 'WTS', '13SNC',
  ],

  // A tag has to leave room for `[TAG] ` plus a usable part of the name
  // inside Discord's 32-character nickname limit.
  MAX_TAG_LENGTH: 16,
  MAX_NICKNAME_LENGTH: 32,

  // Default content for the NODES embed
  DEFAULT_NODES: [
    {
      name: 'North / West HQ',
      value: '• North/West Squad — 2x Supply Box\n• Flex Defence — 1x Supply Box, 1x Engineer'
    },
    {
      name: 'Mid HQ',
      value: '• Meatgrind — 2x Supply Box\n• Flex Attack — 1x Supply Box, 1x Engineer'
    },
    {
      name: 'South / East HQ',
      value: '• South/East Squad — 2x Supply Box\n• Defence — 1x Supply Box, 1x Engineer'
    },
    {
      name: 'Arty',
      value: '• Medium Tank Crew - 1x Supply Box'
    }
  ]
};
