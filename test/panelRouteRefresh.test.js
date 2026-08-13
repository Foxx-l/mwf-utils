/**
 * What the router does around a handler: audit entry, then panel redraw, and
 * neither when the handler reports that nothing happened.
 *
 * The audit store and the payload builder are mocked at module level because
 * both are destructured at import time, so a spy on the module object would
 * come too late.
 */

const calls = [];

jest.mock('../src/utils/lastActionStore', () => ({
  saveLastAction: () => { calls.push('audit'); },
  loadLastAction: () => null,
}));

jest.mock('../src/panel/payload', () => ({
  buildPanelPayload: async () => {
    calls.push('render');
    return { embeds: [], components: [] };
  },
}));

const router = require('../src/events/interactionCreate');

function panelInteraction() {
  return {
    customId: 'admin_panel_select',
    guildId: 'guild-1',
    client: { user: { id: 'bot' } },
    user: { id: 'admin-1', tag: 'Admin#1' },
    deferred: true,
    replied: false,
    isMessageComponent: () => true,
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  calls.length = 0;
});

test('the audit entry is written before the panel is redrawn', async () => {
  // The footer reads the audit store, so redrawing first would show the
  // *previous* action as the latest one.
  await router.runRoute(
    { track: 'Post Nodes', refresh: true, run: async () => ({ ok: true }) },
    panelInteraction(),
  );

  expect(calls).toEqual(['audit', 'render']);
});

test('a handler that reports "nothing performed" skips both', async () => {
  await router.runRoute(
    { track: 'Post Mid Cap Poll', refresh: true, run: async () => false },
    panelInteraction(),
  );

  expect(calls).toEqual([]);
});

test('a route without the flag is never redrawn', async () => {
  await router.runRoute(
    { track: 'Edit Nodes', run: async () => undefined },
    panelInteraction(),
  );

  expect(calls).toEqual(['audit']);
});

test('the redraw lands on the panel, not on the action result', async () => {
  const interaction = panelInteraction();

  await router.runRoute({ refresh: true, run: async () => undefined }, interaction);

  expect(interaction.editReply).toHaveBeenCalledTimes(1);
  expect(interaction.followUp).not.toHaveBeenCalled();
});
