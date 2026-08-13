/**
 * How a panel action answers, and when the router redraws the panel.
 *
 * The contract these tests protect: an action triggered from a panel control
 * must ack with deferUpdate and report through followUp, because that is the
 * only combination that leaves the panel message editable. Getting it wrong is
 * silent — either the refresh does nothing, or the admin's result gets replaced
 * by the panel.
 */

const { ownsPanelMessage, ackPanelAction, reportPanelResult } = require('../src/panel/respond');
const { MENUS } = require('../src/panel/controls');
const router = require('../src/events/interactionCreate');

function componentInteraction(customId) {
  return {
    customId,
    isMessageComponent: () => true,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ownsPanelMessage', () => {
  test('is true for every control the panel renders', () => {
    for (const menu of MENUS) {
      expect(ownsPanelMessage(componentInteraction(menu.id))).toBe(true);
    }
  });

  test('is false for messages that only look related', () => {
    // Confirm dialogs, edit previews and the signups sub-panel are their own
    // messages, so their tokens cannot edit the panel.
    for (const id of ['admin_reset_confirm', 'admin_signups_select', 'rotation_apply:abc']) {
      expect(ownsPanelMessage(componentInteraction(id))).toBe(false);
    }
    expect(ownsPanelMessage({ isMessageComponent: () => false })).toBe(false);
    expect(ownsPanelMessage(undefined)).toBe(false);
  });
});

describe('ack and report', () => {
  test('a panel control defers the update and follows up', async () => {
    const interaction = componentInteraction('admin_rotnodes_select');

    await ackPanelAction(interaction);
    await reportPanelResult(interaction, { embeds: ['result'] });

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({
      embeds: ['result'],
      flags: expect.anything(), // ephemeral
    }));
    // Editing the reply here would overwrite the panel with the result.
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('the same handler reached elsewhere keeps its own ephemeral reply', async () => {
    const interaction = componentInteraction('lineup_editserver:c:m');

    await ackPanelAction(interaction);
    await reportPanelResult(interaction, { embeds: ['result'] });

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ embeds: ['result'] });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});

describe('the refresh flag on routes', () => {
  const panelRoutes = router.SELECT_ROUTES.filter(r => r.id.startsWith('admin_') && r.id.endsWith('_select'));

  test('exactly the state-changing panel actions ask for a redraw', () => {
    const flagged = panelRoutes
      .filter(r => r.refresh)
      .map(r => `${r.id}|${r.value ?? r.valuePrefix}`)
      .sort();

    expect(flagged).toEqual([
      'admin_faction_select|reload',
      'admin_panel_select|healthcheck',
      'admin_panel_select|midcap',
      'admin_panel_select|postall',
      'admin_rotnodes_select|nodes:post',
      'admin_rotnodes_select|rotation:sync',
      'admin_rotnodes_select|rotation:undo',
      'admin_server_select|post:',
    ]);
  });

  test('nothing that opens a modal or a confirm dialog refreshes', () => {
    // Those interactions belong to another message, and nothing has changed yet.
    const mustNotRefresh = [
      ['admin_faction_select', 'reset'],
      ['admin_lineup_select', 'edit:S1'],
      ['admin_server_select', 'edit:S2'],
      ['admin_rotnodes_select', 'rotation:edit'],
      ['admin_rotnodes_select', 'rotation:advance'],
      ['admin_rotnodes_select', 'rotation:reset'],
      ['admin_rotnodes_select', 'nodes:edit'],
      ['admin_panel_select', 'clearlogs'],
      ['admin_panel_select', 'signups'],
    ];
    for (const [id, value] of mustNotRefresh) {
      const route = router.findRoute(router.SELECT_ROUTES, id, value);
      expect(route).not.toBeNull();
      expect(route.refresh).toBeFalsy();
    }
  });

  test('the explicit Refresh action does its own redraw', () => {
    const route = router.findRoute(router.SELECT_ROUTES, 'admin_panel_select', 'refresh');
    // It refreshes inside run() so a failure surfaces to the admin who asked.
    expect(route.refresh).toBeFalsy();
    expect(typeof route.run).toBe('function');
  });
});
