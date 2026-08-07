/**
 * interactionCreate router — dispatch tables, admin gate, and end-to-end
 * routing, using plain fakes (no Discord API).
 */

process.env.ALLIES_ROLE    = 'role-allies-s1';
process.env.AXIS_ROLE      = 'role-axis-s1';
process.env.ALLIES_S2_ROLE = 'role-allies-s2';
process.env.AXIS_S2_ROLE   = 'role-axis-s2';
delete process.env.ADMIN_LOG_CHANNEL;
delete process.env.ALLOWED_GUILDS;

const router = require('../src/events/interactionCreate');

function baseInteraction(extra = {}) {
  return {
    guildId: null,
    customId: '',
    values: [],
    replied: false,
    deferred: false,
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

function withPermissions(interaction, isAdmin) {
  interaction.member = { permissions: { has: () => isAdmin } };
  return interaction;
}

describe('findRoute', () => {
  test('matches exact ids before prefixes in table order', () => {
    const routes = [
      { id: 'admin_reset_confirm', run: 'A' },
      { prefix: 'admin_', run: 'B' },
    ];
    expect(router.findRoute(routes, 'admin_reset_confirm').run).toBe('A');
    expect(router.findRoute(routes, 'admin_something_else').run).toBe('B');
    expect(router.findRoute(routes, 'unrelated')).toBeNull();
  });

  test('select routes match on customId and value', () => {
    const route = router.findRoute(router.SELECT_ROUTES, 'admin_rotnodes_select', 'rotation:sync');
    expect(route.track).toBe('Sync Map Rotation');
    expect(router.findRoute(router.SELECT_ROUTES, 'admin_rotnodes_select', 'rotation:nope')).toBeNull();
  });

  test('value prefixes capture parameterized options', () => {
    const route = router.findRoute(router.SELECT_ROUTES, 'admin_lineup_select', 'edit:S2');
    expect(route).not.toBeNull();
  });

  test('the mid cap panel action is audit-logged', () => {
    const route = router.findRoute(router.SELECT_ROUTES, 'admin_panel_select', 'midcap');
    expect(route.track).toBe('Post Mid Cap Poll');
  });
});

describe('execute() dispatch', () => {
  test('unknown buttons are ignored without throwing', async () => {
    const interaction = baseInteraction({ isButton: () => true, customId: 'what_is_this' });
    await expect(router.execute(interaction)).resolves.toBeUndefined();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('admin buttons deny non-admins', async () => {
    const interaction = withPermissions(
      baseInteraction({ isButton: () => true, customId: 'admin_reset_confirm' }),
      false,
    );
    await router.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([expect.objectContaining({
        data: expect.objectContaining({ title: expect.stringContaining('Permission Denied') }),
      })]),
    }));
  });

  test('unknown admin_ buttons still hit the permission gate', async () => {
    const interaction = withPermissions(
      baseInteraction({ isButton: () => true, customId: 'admin_mystery' }),
      false,
    );
    await router.execute(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  test('select menus deny non-admins before value matching', async () => {
    const interaction = withPermissions(
      baseInteraction({ isStringSelectMenu: () => true, customId: 'admin_panel_select', values: ['refresh'] }),
      false,
    );
    await router.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([expect.objectContaining({
        data: expect.objectContaining({ title: expect.stringContaining('Permission Denied') }),
      })]),
    }));
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  test('rotation confirm buttons use their own denial text', async () => {
    const interaction = withPermissions(
      baseInteraction({ isButton: () => true, customId: 'rotation_advance_confirm' }),
      false,
    );
    await router.execute(interaction);
    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toBe('Administrator permission is required.');
  });

  test('rotation_action_cancel reaches the handler for admins', async () => {
    const interaction = withPermissions(
      baseInteraction({ isButton: () => true, customId: 'rotation_action_cancel' }),
      true,
    );
    await router.execute(interaction);
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: '❎ Rotation action cancelled.',
    }));
  });

  test('faction_ buttons route end-to-end into the faction handler', async () => {
    const held = new Set();
    const interaction = baseInteraction({
      isButton: () => true,
      customId: 'faction_allies_s1',
      user: { id: 'router-user-1', tag: 'Router#1', displayAvatarURL: () => 'https://x.invalid/a.png' },
      client: {},
      member: {
        roles: {
          cache: { has: id => held.has(id) },
          add: jest.fn(async id => held.add(id)),
          remove: jest.fn(async () => {}),
        },
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    });

    await router.execute(interaction);

    expect(interaction.member.roles.add).toHaveBeenCalledWith('role-allies-s1', 'Faction selection');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('joined'),
    }));
  });

  test('autocomplete reaches the command module', async () => {
    const autocomplete = jest.fn().mockResolvedValue(undefined);
    const interaction = baseInteraction({
      isAutocomplete: () => true,
      commandName: 'tag',
      client: { commands: new Map([['tag', { autocomplete }]]) },
      respond: jest.fn().mockResolvedValue(undefined),
    });

    await router.execute(interaction);

    expect(autocomplete).toHaveBeenCalledWith(interaction);
    expect(interaction.respond).not.toHaveBeenCalled();
  });

  test('autocomplete for a command without a handler answers with an empty list', async () => {
    const interaction = baseInteraction({
      isAutocomplete: () => true,
      commandName: 'ping',
      client: { commands: new Map([['ping', {}]]) },
      respond: jest.fn().mockResolvedValue(undefined),
    });

    await router.execute(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  test('an autocomplete handler that throws does not try to reply', async () => {
    const interaction = baseInteraction({
      isAutocomplete: () => true,
      commandName: 'tag',
      client: { commands: new Map([['tag', { autocomplete: () => { throw new Error('boom'); } }]]) },
      respond: jest.fn().mockResolvedValue(undefined),
    });

    await expect(router.execute(interaction)).resolves.toBeUndefined();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('handler errors produce the generic ephemeral reply', async () => {
    // A faction button with a broken member object forces the handler to throw.
    const interaction = baseInteraction({
      isButton: () => true,
      customId: 'faction_allies_s1',
      user: { id: 'router-user-2', tag: 'Router#2' },
      member: { roles: null },
    });
    await router.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: '❌ An error occurred.',
    }));
  });
});
