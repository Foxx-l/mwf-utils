/**
 * Redrawing the panel.
 *
 * The regression this file exists for: the panel is ephemeral, so it can only be
 * edited through the interaction token (`editReply`). The old code used
 * `interaction.message.edit()` and swallowed the resulting error, so Refresh
 * silently did nothing — hence the assertions that `message.edit` is never
 * touched and that failures are reported.
 */

jest.mock('../src/panel/payload', () => ({
  buildPanelPayload: jest.fn(async () => ({ embeds: ['panel-embed'], components: ['panel-rows'] })),
}));

const { buildPanelPayload } = require('../src/panel/payload');
const { refreshPanel, refreshPanelSafely, panelRefreshBlocker } = require('../src/panel/refresh');

function panelInteraction(overrides = {}) {
  return {
    customId: 'admin_panel_select',
    guildId: 'guild-1',
    client: { user: { id: 'bot' } },
    deferred: true,
    replied: false,
    isMessageComponent: () => true,
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    message: { edit: jest.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('refreshPanel', () => {
  test('edits the panel through the interaction token', async () => {
    const interaction = panelInteraction();

    await refreshPanel(interaction);

    expect(buildPanelPayload).toHaveBeenCalledWith(interaction.client, 'guild-1');
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({ embeds: ['panel-embed'], components: ['panel-rows'] });
    // The bug: Message#edit cannot touch an ephemeral message.
    expect(interaction.message.edit).not.toHaveBeenCalled();
  });

  test('refuses an interaction that has not been acked yet', async () => {
    const interaction = panelInteraction({ deferred: false, replied: false });
    await expect(refreshPanel(interaction)).rejects.toThrow(/deferUpdate/);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('refuses a control that is not on the panel message', async () => {
    // A confirm dialog is its own ephemeral message; editing it would replace
    // the dialog with the panel.
    const interaction = panelInteraction({ customId: 'admin_reset_confirm' });
    await expect(refreshPanel(interaction)).rejects.toThrow(/not a control on the panel message/);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('propagates an edit failure, since the refresh was the point of the click', async () => {
    const interaction = panelInteraction({
      editReply: jest.fn().mockRejectedValue(new Error('Unknown Message')),
    });
    await expect(refreshPanel(interaction)).rejects.toThrow('Unknown Message');
  });
});

describe('refreshPanelSafely', () => {
  test('redraws the panel after another action', async () => {
    const interaction = panelInteraction({ customId: 'admin_rotnodes_select' });

    await refreshPanelSafely(interaction);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('never throws when the edit fails, but tells the admin the panel is stale', async () => {
    const interaction = panelInteraction({
      editReply: jest.fn().mockRejectedValue(new Error('Invalid Form Body')),
    });

    await expect(refreshPanelSafely(interaction)).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('could not be refreshed'),
    }));
  });

  test('does nothing, quietly, for an interaction that cannot refresh', async () => {
    const interaction = panelInteraction({ customId: 'admin_signups_cancel_confirm' });

    await expect(refreshPanelSafely(interaction)).resolves.toBeUndefined();

    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});

describe('panelRefreshBlocker', () => {
  test('passes a deferred panel select', () => {
    expect(panelRefreshBlocker(panelInteraction())).toBeNull();
  });

  test('rejects a non-component interaction', () => {
    expect(panelRefreshBlocker({ isMessageComponent: () => false })).toMatch(/message-component/);
    expect(panelRefreshBlocker(null)).toMatch(/message-component/);
  });
});
