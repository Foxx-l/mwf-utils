/**
 * Team Rep approval flow — request creation on message, duplicate
 * suppression, and the Approve / Reject button handlers. Plain fakes only.
 */

process.env.TEAM_REP_CHANNEL = 'chan-tr';
process.env.TEAM_REP_ROLE_ID = 'role-tr';
process.env.TEAM_REP_PING_ROLE = 'role-ping';
process.env.TEAM_REP_COOLDOWN_MS = '60000';
delete process.env.ADMIN_LOG_CHANNEL;

const requestFlow = require('../src/events/messageCreate.teamrep');
const { handleTeamRepApprove, handleTeamRepReject } = require('../src/handlers/interactions/teamrepHandler');

let userCounter = 0;

function makeMember(id, { hasRole = false } = {}) {
  return {
    id,
    user: { tag: `Member#${id}` },
    roles: {
      cache: { has: () => hasRole },
      add: jest.fn(async () => {}),
    },
    toString: () => `<@${id}>`,
  };
}

function makeMessage(member, { pending = [] } = {}) {
  const id = `msg-${++userCounter}`;
  return {
    id,
    author: { bot: false, id: member.id, tag: member.user.tag },
    guild: {
      members: { fetch: jest.fn(async () => member) },
    },
    channel: {
      id: 'chan-tr',
      client: { user: { id: 'bot-id' } },
      toString: () => '<#chan-tr>',
      send: jest.fn(async () => ({ id: 'approval-msg' })),
      messages: { fetch: jest.fn(async () => pending) },
    },
    react: jest.fn(async () => {}),
    client: { user: { id: 'bot-id' } },
  };
}

describe('request flow (messageCreate)', () => {
  test('posts an approval embed with ping and yes/no buttons', async () => {
    const member = makeMember(`u-${++userCounter}`);
    const message = makeMessage(member);

    await requestFlow.execute(message);

    expect(message.channel.send).toHaveBeenCalledTimes(1);
    const payload = message.channel.send.mock.calls[0][0];
    expect(payload.content).toBe('<@&role-ping>');
    expect(payload.reply).toMatchObject({ messageReference: message.id });
    const buttons = payload.components[0].components;
    expect(buttons.map(b => b.data.custom_id)).toEqual([
      `teamrep_approve:${member.id}:${message.id}`,
      `teamrep_reject:${member.id}:${message.id}`,
    ]);
    expect(message.react).toHaveBeenCalledWith('⏳');
  });

  test('does not duplicate while a request is still pending', async () => {
    const member = makeMember(`u-${++userCounter}`);
    const pending = [{
      author: { id: 'bot-id' },
      components: [{ components: [{ customId: `teamrep_approve:${member.id}:old-msg` }] }],
    }];
    const message = makeMessage(member, { pending });

    await requestFlow.execute(message);

    expect(message.channel.send).not.toHaveBeenCalled();
    expect(message.react).toHaveBeenCalledWith('⏳');
  });

  test('members who already hold the role get ℹ️ and no embed', async () => {
    const member = makeMember(`u-${++userCounter}`, { hasRole: true });
    const message = makeMessage(member);

    await requestFlow.execute(message);

    expect(message.react).toHaveBeenCalledWith('ℹ️');
    expect(message.channel.send).not.toHaveBeenCalled();
  });
});

describe('approval handlers', () => {
  function makeInteraction(userId, member, { found = true } = {}) {
    const originalReact = jest.fn(async () => {});
    const hourglassRemove = jest.fn(async () => {});
    return {
      customId: `teamrep_approve:${userId}:orig-1`,
      user: { id: 'admin-1' },
      client: {},
      guild: {
        roles: { cache: new Map([['role-tr', { id: 'role-tr', position: 0 }]]) },
        members: {
          me: { roles: { highest: { position: 10 } } },
          fetch: jest.fn(async () => {
            if (!found) throw new Error('Unknown Member');
            return member;
          }),
        },
      },
      channel: {
        messages: {
          fetch: jest.fn(async () => ({
            react: originalReact,
            reactions: { resolve: () => ({ remove: hourglassRemove }) },
          })),
        },
      },
      deferUpdate: jest.fn(async () => {}),
      deleteReply: jest.fn(async () => {}),
      update: jest.fn(async () => {}),
      followUp: jest.fn(async () => {}),
      _originalReact: originalReact,
      _hourglassRemove: hourglassRemove,
    };
  }

  test('approve assigns the role, reacts ✅ and removes the public embed', async () => {
    const member = makeMember('u-appr-1');
    const interaction = makeInteraction('u-appr-1', member);

    await handleTeamRepApprove(interaction);

    expect(member.roles.add).toHaveBeenCalledWith('role-tr');
    expect(interaction._hourglassRemove).toHaveBeenCalled();
    expect(interaction._originalReact).toHaveBeenCalledWith('✅');
    expect(interaction.deleteReply).toHaveBeenCalled(); // public card gone; log-only record
    expect(interaction.update).not.toHaveBeenCalled();
  });

  test('reject never assigns the role and removes the public embed', async () => {
    const member = makeMember('u-rej-1');
    const interaction = makeInteraction('u-rej-1', member);
    interaction.customId = 'teamrep_reject:u-rej-1:orig-1';

    await handleTeamRepReject(interaction);

    expect(member.roles.add).not.toHaveBeenCalled();
    expect(interaction._hourglassRemove).toHaveBeenCalled();
    expect(interaction._originalReact).toHaveBeenCalledWith('❌');
    expect(interaction.deleteReply).toHaveBeenCalled();
  });

  test('approving a member who left closes the request quietly', async () => {
    const interaction = makeInteraction('u-gone', null, { found: false });

    await handleTeamRepApprove(interaction);

    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('a failed role assignment keeps the public embed for retry', async () => {
    const member = makeMember('u-fail-1');
    member.roles.add = jest.fn(async () => {
      const err = new Error('Missing Permissions');
      err.code = 50013;
      throw err;
    });
    const interaction = makeInteraction('u-fail-1', member);

    await handleTeamRepApprove(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Could not assign'),
    }));
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });
});
