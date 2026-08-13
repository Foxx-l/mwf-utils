// @ts-check
/**
 * controls.js — The panel's interactive controls.
 *
 * Every customId lives here, so the renderer and the router's route tables
 * cannot drift apart, and adding an action is a data change.
 */

const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');

function factionMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_faction_select')
      .setPlaceholder('🛡️  Faction Embed — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('reload')
          .setLabel('Reload Faction Embed')
          .setDescription('Delete the current embed and post a fresh one.')
          .setEmoji('🔄'),
        new StringSelectMenuOptionBuilder()
          .setValue('reset')
          .setLabel('Reset Roles')
          .setDescription('Remove Allies / Axis roles from every member.')
          .setEmoji('♻️')
      )
  );
}

function lineupMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_lineup_select')
      .setPlaceholder('📋  Lineup — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S1')
          .setLabel('Edit Lineup — S1')
          .setDescription('Edit the Server 1 lineup caption.')
          .setEmoji('✏️'),
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S2')
          .setLabel('Edit Lineup — S2')
          .setDescription('Edit the Server 2 lineup caption.')
          .setEmoji('✏️')
      )
  );
}

function serverMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_server_select')
      .setPlaceholder('🖥️  Server Details — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('post:S1')
          .setLabel('Post Server Details — S1')
          .setDescription('Publish the Server 1 details embed.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('post:S2')
          .setLabel('Post Server Details — S2')
          .setDescription('Publish the Server 2 details embed.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S1')
          .setLabel('Edit Server Details — S1')
          .setDescription('Edit the Server 1 details embed.')
          .setEmoji('✏️'),
        new StringSelectMenuOptionBuilder()
          .setValue('edit:S2')
          .setLabel('Edit Server Details — S2')
          .setDescription('Edit the Server 2 details embed.')
          .setEmoji('✏️')
      )
  );
}

function rotNodesMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_rotnodes_select')
      .setPlaceholder('🗺️ 📍  Map Rotation & Nodes — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:sync')
          .setLabel('Sync Map Rotation')
          .setDescription('Repair month alignment, cache, message, and duplicates.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:edit')
          .setLabel('Edit Map Rotation')
          .setDescription('Edit the current rotation events.')
          .setEmoji('✏️'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:advance')
          .setLabel('Advance Rotation (+1 month)')
          .setDescription('Preview and confirm moving the window forward.')
          .setEmoji('⏩'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:reset')
          .setLabel('Reset to Current Month')
          .setDescription('Rebuild the current two-month window; supports Undo.')
          .setEmoji('♻️'),
        new StringSelectMenuOptionBuilder()
          .setValue('rotation:undo')
          .setLabel('Undo Rotation Change')
          .setDescription('Restore the most recent saved rotation state.')
          .setEmoji('↩️'),
        new StringSelectMenuOptionBuilder()
          .setValue('nodes:post')
          .setLabel('Post Nodes')
          .setDescription('Publish the NODES embed to every configured channel.')
          .setEmoji('📤'),
        new StringSelectMenuOptionBuilder()
          .setValue('nodes:edit')
          .setLabel('Edit Nodes')
          .setDescription('Edit the current NODES embed fields.')
          .setEmoji('✏️')
      )
  );
}

function panelMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_panel_select')
      .setPlaceholder('🛠️  Panel — choose action')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setValue('refresh')
          .setLabel('Refresh Status')
          .setDescription('Re-check posted state of every embed.')
          .setEmoji('🔄'),
        new StringSelectMenuOptionBuilder()
          .setValue('postall')
          .setLabel('Post All Missing')
          .setDescription('Publish default embeds for every 🔴 section (Server, Rotation, Nodes).')
          .setEmoji('📮'),
        new StringSelectMenuOptionBuilder()
          .setValue('midcap')
          .setLabel('Post Mid Cap Poll')
          .setDescription("Post the Discord poll for the next match's mid cap.")
          .setEmoji('📊'),
        new StringSelectMenuOptionBuilder()
          .setValue('signups')
          .setLabel('Signups — manage')
          .setDescription('Per-clan RaidHelper signups: post, cancel, auto-post.')
          .setEmoji('📅'),
        new StringSelectMenuOptionBuilder()
          .setValue('healthcheck')
          .setLabel('Healthcheck')
          .setDescription('Verify env, channel perms, roles, and cached message IDs.')
          .setEmoji('🩺'),
        new StringSelectMenuOptionBuilder()
          .setValue('clearlogs')
          .setLabel('Clear Log Channel')
          .setDescription('Delete every message in the admin log channel.')
          .setEmoji('🧹')
      )
  );
}

/** The panel's component rows, in display order. */
function buildPanelComponents() {
  return [factionMenu(), lineupMenu(), serverMenu(), rotNodesMenu(), panelMenu()];
}

module.exports = {
  factionMenu,
  lineupMenu,
  serverMenu,
  rotNodesMenu,
  panelMenu,
  buildPanelComponents,
};
