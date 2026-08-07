/**
 * Team Rep approval flow — the request card is posted to the ADMIN LOG
 * channel (public channel only gets reactions), duplicate suppression,
 * and the Approve / Reject button handlers. Plain fakes only.
 */

process.env.TEAM_REP_CHANNEL = 'chan-tr';
process.env.TEAM_REP_ROLE_ID = 'role-tr';
process.env.TEAM_REP_PING_ROLE = 'role-ping';
process.env.TEAM_REP_COOLDOWN_MS = '60000';
process.env.ADMIN_LOG_CHANNEL = 'log-ch';
delete process.env.ALLOWED_GUILDS;

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

function makeLogChannel({ pending = [] } = {}) {
  return {
    id: 'log-ch',
    client: { user: { id: 'bot-id' } },
    send: jest.fn(async () => ({ id: 'card-msg' })),
    messages: { fetch: jest.fn(async () => pending) },
  };
}

function makeMessage(member, { logChannel = makeLogChannel() } = {}) {
  const id = `msg-${++userCounter}`;
  return {
    id,
    guildId: 'guild-1',
    author: { bot: false, id: member.id, tag: member.user.tag },
    guild: {
      members: { fetch: jest.fn(async () => member) },
    },
    channel: {
      id: 'chan-tr',
      client: { user: { id: 'bot-id' } },
      toString: () => '<#chan-tr>',
      send: jest.fn(async () => ({ id: 'should-not-happen' })),
      messages: { fetch: jest.fn(async () => []) },
    },
    react: jest.fn(async () => {}),
    client: {
      user: { id: 'bot-id' },
      channels: {
        fetch: jest.fn(async chanId => (chanId === 'log-ch' ? logChannel : null)),
      },
    },
    _logChannel: logChannel,
  };
}

describe('request flow (messageCreate)', () => {
  test('posts the approval card to the LOG channel with ping and yes/no buttons', async () => {
    const member = makeMember(`u-${++userCounter}`);
    const message = makeMessage(member);

    await requestFlow.execute(message);

    expect(message._logChannel.send).toHaveBeenCalledTimes(1);
    expect(message.channel.send).not.toHaveBeenCalled(); // public channel stays clean
    const payload = message._logChannel.send.mock.calls[0][0];
    expect(payload.content).toBe('<@&role-ping>');
    expect(payload.reply).toBeUndefined(); // no cross-channel reply
    const buttons = payload.components[0].components;
    expect(buttons.map(b => b.data.custom_id)).toEqual([
      `teamrep_approve:${member.id}:${message.id}:chan-tr`,
      `teamrep_reject:${member.id}:${message.id}:chan-tr`,
    ]);
    expect(payload.embeds[0].data.description).toContain('discord.com/channels/guild-1/chan-tr/');
    expect(message.react).toHaveBeenCalledWith('⏳');
  });

  test('does not duplicate while a card is still pending in the log channel', async () => {
    const member = makeMember(`u-${++userCounter}`);
    const logChannel = makeLogChannel({
      pending: [{
        author: { id: 'bot-id' },
        components: [{ components: [{ customId: `teamrep_approve:${member.id}:old-msg:chan-tr` }] }],
      }],
    });
    const message = makeMessage(member, { logChannel });

    await requestFlow.execute(message);

    expect(logChannel.send).not.toHaveBeenCalled();
    expect(message.react).toHaveBeenCalledWith('⏳');
  });

  test('members who already hold the role get ℹ️ and no card', async () => {
    const member = makeMember(`u-${++userCounter}`, { hasRole: true });
    const message = makeMessage(member);

    await requestFlow.execute(message);

    expect(message.react).toHaveBeenCalledWith('ℹ️');
    expect(message._logChannel.send).not.toHaveBeenCalled();
  });
});

describe('approval handlers', () => {
  function makeInteraction(userId, member, { found = true } = {}) {
    const originalReact = jest.fn(async () => {});
    const hourglassRemove = jest.fn(async () => {});
    const original = {
      react: originalReact,
      reactions: { resolve: () => ({ remove: hourglassRemove }) },
    };
    return {
      customId: `teamrep_approve:${userId}:orig-1:chan-tr`,
      user: { id: 'admin-1' },
      client: {},
      guild: {
        roles: { cache: new Map([['role-tr', { id: 'role-tr', position: 0 }]]) },
        channels: { fetch: jest.fn(async () => ({ messages: { fetch: jest.fn(async () => original) } })) },
        members: {
          me: { roles: { highest: { position: 10 } } },
          fetch: jest.fn(async () => {
            if (!found) throw new Error('Unknown Member');
            return member;
          }),
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

  test('approve assigns the role, reacts ✅ and removes the card', async () => {
    const member = makeMember('u-appr-1');
    const interaction = makeInteraction('u-appr-1', member);

    await handleTeamRepApprove(interaction);

    expect(member.roles.add).toHaveBeenCalledWith('role-tr');
    expect(interaction._hourglassRemove).toHaveBeenCalled();
    expect(interaction._originalReact).toHaveBeenCalledWith('✅');
    expect(interaction.deleteReply).toHaveBeenCalled(); // card gone; log-only record
    expect(interaction.update).not.toHaveBeenCalled();
  });

  test('reject never assigns the role and removes the card', async () => {
    const member = makeMember('u-rej-1');
    const interaction = makeInteraction('u-rej-1', member);
    interaction.customId = 'teamrep_reject:u-rej-1:orig-1:chan-tr';

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

  test('a failed role assignment keeps the card for retry', async () => {
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
