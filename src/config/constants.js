module.exports = {
  REQUIRED_ENV_VARS: [
    'BOT_TOKEN',
    'CLIENT_ID',
    'GUILD_ID',
    'FACTION_CHANNEL',
    'ALLIES_ROLE',
    'AXIS_ROLE',
    'ALLIES_S2_ROLE',
    'AXIS_S2_ROLE',
  ],

  // Shared thumbnail used across all embeds
  THUMBNAIL_URL: 'https://raw.githubusercontent.com/janush7/faction-bot/main/assets/MWF.png',

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
