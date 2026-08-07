// @ts-check
const { EmbedBuilder } = require('discord.js');
const { THUMBNAIL_URL } = require('../config/constants');
const { COLORS } = require('../config/theme');
const { TEAMS } = require('../config/factions');
const { bar, peak, totals, leaders } = require('./midCapVote');

function createFactionEmbed() {
  return new EmbedBuilder()
    .setTitle('Choose your side!')
    .setDescription("Choose the side you'll be playing on by clicking one of the buttons below. After selecting a side, you'll gain access to the channels where the SL briefings will take place. Good luck, and see you on the server!")
    .setColor(COLORS.primary)
    .setThumbnail(THUMBNAIL_URL);
}

/**
 * Public "how do I get my clan tag" embed, posted with `/tags post`.
 * @param {string[]} tags - the currently available tags
 */
function createTagInfoEmbed(tags) {
  const list = tags.length
    ? tags.map(t => `\`[${t}]\``).join(' · ')
    : '_No tags configured yet._';

  return new EmbedBuilder()
    .setTitle('🏷️ Clan Tags')
    .setDescription(
      'Use **`/tag set`** to put your clan tag in front of your nickname, like `[TAG] Name`.\n' +
      'The tag field autocompletes — pick your clan from the list.\n\n' +
      'Use **`/tag remove`** to drop it again. You can switch or remove your tag at any time.\n' +
      "Please don't use the tag of a clan you aren't a member of."
    )
    .addFields({ name: 'Available tags', value: list })
    .setColor(COLORS.primary)
    .setThumbnail(THUMBNAIL_URL);
}

/**
 * Mid Cap vote embed. Both teams vote on the same three caps and each cap
 * shows one bar per team, scaled to the highest single count so the bars are
 * comparable down the list.
 *
 * @param {{ date: string, time: string, map: string, unix: number, live: boolean }|null} match
 * @param {string[]} caps
 * @param {{ cap: string, allies: number, axis: number }[]} tally
 */
function createMidCapEmbed(match, caps, tally) {
  const embed = new EmbedBuilder()
    .setTitle('🎯 Mid Cap Vote')
    .setColor(COLORS.primary)
    .setThumbnail(THUMBNAIL_URL);

  if (!match) {
    return embed.setDescription(
      'No upcoming match is scheduled in the map rotation, so there is nothing to vote on yet.\n' +
      'An admin can fix this with **Sync Map Rotation** in `/panel`.'
    );
  }
  if (!caps.length) {
    return embed.setDescription(
      `Next match: <t:${match.unix}:F> — **${match.map}**\n\n` +
      `No mid caps are configured for **${match.map}**, so voting is closed. ` +
      'An admin needs to add them to `src/config/midCaps.js`.'
    );
  }

  const scale = peak(tally);
  const { allies: alliesTotal, axis: axisTotal } = totals(tally);
  const alliesLead = leaders(tally, 'allies');
  const axisLead = leaders(tally, 'axis');

  const leadLine = team => {
    const lead = team === 'allies' ? alliesLead : axisLead;
    const meta = TEAMS[team];
    if (!lead.length) return `${meta.emoji} **${meta.label}** — no votes yet`;
    if (lead.length > 1) return `${meta.emoji} **${meta.label}** — tied: ${lead.join(' / ')}`;
    return `${meta.emoji} **${meta.label}** — ${lead[0]}`;
  };

  embed.setDescription([
    `${match.live ? '🔴 **Live now**' : 'Next match'}: <t:${match.unix}:F> · <t:${match.unix}:R>`,
    `Map: **${match.map}**`,
    '',
    'Vote for the mid cap your team wants. Your faction role decides which side',
    'your vote counts for — click the same cap again to take your vote back.',
    '',
    leadLine('allies'),
    leadLine('axis'),
  ].join('\n'));

  for (const row of tally) {
    embed.addFields({
      name: row.cap,
      value:
        `${TEAMS.allies.emoji} \`${bar(row.allies, scale)}\` **${row.allies}**\n` +
        `${TEAMS.axis.emoji} \`${bar(row.axis, scale)}\` **${row.axis}**`,
    });
  }

  return embed.setFooter({
    text: `${alliesTotal} Allies · ${axisTotal} Axis vote(s) — one vote each`,
  }).setTimestamp();
}

function createSuccessEmbed(title, description) {
  // Same dark navy as every other embed — the ✅ in the title carries the
  // status, not the stripe color.
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(COLORS.primary)
    .setTimestamp();
}

function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(COLORS.error)
    .setTimestamp();
}

module.exports = { createFactionEmbed, createTagInfoEmbed, createMidCapEmbed, createSuccessEmbed, createErrorEmbed };
