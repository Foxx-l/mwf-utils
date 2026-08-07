/**
 * factionHandler — cooldown, concurrency guard, and rollback behaviour.
 * Uses plain fakes for the interaction/member so no Discord API is touched.
 */

process.env.ALLIES_ROLE    = 'role-allies-s1';
process.env.AXIS_ROLE      = 'role-axis-s1';
process.env.ALLIES_S2_ROLE = 'role-allies-s2';
process.env.AXIS_S2_ROLE   = 'role-axis-s2';
process.env.FACTION_SWAP_COOLDOWN_SECONDS = '20';
delete process.env.ADMIN_LOG_CHANNEL; // keep sendLog a no-op

const { handleFactionSelection } = require('../src/handlers/interactions/factionHandler');

let userCounter = 0;

function makeInteraction(heldRoles = []) {
  const held = new Set(heldRoles);
  const interaction = {
    user: {
      id: `user-${++userCounter}`,
      tag: `User#${userCounter}`,
      displayAvatarURL: () => 'https://example.invalid/avatar.png',
    },
    client: {},
    member: {
      roles: {
        cache: { has: id => held.has(id) },
        add: jest.fn(async ids => {
          (Array.isArray(ids) ? ids : [ids]).forEach(id => held.add(id));
        }),
        remove: jest.fn(async ids => {
          (Array.isArray(ids) ? ids : [ids]).forEach(id => held.delete(id));
        }),
      },
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

describe('handleFactionSelection', () => {
  test('joins a faction and confirms', async () => {
    const interaction = makeInteraction();
    await handleFactionSelection(interaction, 'allies_s1');

    expect(interaction.member.roles.add).toHaveBeenCalledWith('role-allies-s1', 'Faction selection');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('joined'),
    }));
  });

  test('rejects a swap within the cooldown window', async () => {
    const interaction = makeInteraction();
    await handleFactionSelection(interaction, 'allies_s1'); // burns the cooldown

    const again = { ...interaction, reply: jest.fn().mockResolvedValue(undefined) };
    await handleFactionSelection(again, 'axis_s1');
    expect(again.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/Slow down|already on/),
    }));
  });

  test('blocks overlapping double-clicks for the same user', async () => {
    const first = makeInteraction();
    const second = {
      ...first,
      user: first.user, // same Discord user
      member: first.member,
      reply: jest.fn().mockResolvedValue(undefined),
    };

    const p1 = handleFactionSelection(first, 'allies_s1');
    const p2 = handleFactionSelection(second, 'axis_s1');
    await Promise.all([p1, p2]);

    expect(second.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('already in progress'),
    }));
    expect(first.member.roles.add).toHaveBeenCalledTimes(1);
  });

  test('restores the previous role when adding the new one fails', async () => {
    const interaction = makeInteraction(['role-axis-s1']);
    interaction.member.roles.add
      .mockRejectedValueOnce(new Error('Missing Permissions')) // the new role fails
      .mockResolvedValueOnce(undefined);                       // the restore succeeds

    await handleFactionSelection(interaction, 'allies_s1');

    expect(interaction.member.roles.remove).toHaveBeenCalledWith(['role-axis-s1'], 'Switching faction');
    expect(interaction.member.roles.add).toHaveBeenLastCalledWith(['role-axis-s1'], 'Restoring roles after failed faction switch');
    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    expect(description).toContain('could not add the selected faction role');
    expect(description.toLowerCase()).toContain('restored');
  });

  test('reports an unconfigured faction role instead of crashing', async () => {
    const saved = process.env.AXIS_S2_ROLE;
    delete process.env.AXIS_S2_ROLE;
    try {
      const interaction = makeInteraction();
      await handleFactionSelection(interaction, 'axis_s2');
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.arrayContaining([expect.objectContaining({
          data: expect.objectContaining({ title: expect.stringContaining('Config Error') }),
        })]),
      }));
    } finally {
      process.env.AXIS_S2_ROLE = saved;
    }
  });
});
