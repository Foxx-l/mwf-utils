const { assignTeamRep } = require('../src/events/messageCreate.teamrep');

describe('assignTeamRep', () => {
  test('returns missing_role when role not in guild', async () => {
    const guild = { roles: { cache: new Map() } };
    const member = { roles: { cache: new Map(), add: jest.fn() } };
    const res = await assignTeamRep(guild, member, 'nonexistent-role-id');
    expect(res.fatal).toBe(true);
    expect(res.reason).toBe('missing_role');
  });

  test('returns role_hierarchy when bot role is too low', async () => {
    const role = { id: 'r1', position: 100 };
    const guild = {
      roles: { cache: new Map([['r1', role]]) },
      members: { me: { roles: { highest: { position: 50 } } } },
    };
    const member = { roles: { cache: new Map(), add: jest.fn() } };
    const res = await assignTeamRep(guild, member, 'r1');
    expect(res.fatal).toBe(true);
    expect(res.reason).toBe('role_hierarchy');
  });

  test('retries transient error then succeeds', async () => {
    const role = { id: 'r1', position: 0 };
    const guild = {
      roles: { cache: new Map([['r1', role]]) },
      members: { me: { roles: { highest: { position: 100 } } } },
    };
    let call = 0;
    const member = {
      roles: {
        cache: new Map(),
        add: jest.fn().mockImplementation(() => {
          call += 1;
          if (call === 1) {
            const e = new Error('rate limit');
            e.code = 500;
            return Promise.reject(e);
          }
          return Promise.resolve();
        })
      }
    };
    const res = await assignTeamRep(guild, member, 'r1');
    expect(res.success).toBe(true);
    expect(res.attempts).toBeGreaterThanOrEqual(2);
  });

  test('falls back to roles.fetch when the role is not cached', async () => {
    const role = { id: 'r1', position: 0 };
    const guild = {
      roles: {
        cache: new Map(),
        fetch: jest.fn().mockResolvedValue(role),
      },
      members: { me: { roles: { highest: { position: 100 } } } },
    };
    const member = { roles: { cache: new Map(), add: jest.fn().mockResolvedValue(undefined) } };
    const res = await assignTeamRep(guild, member, 'r1');
    expect(guild.roles.fetch).toHaveBeenCalledWith('r1');
    expect(res.success).toBe(true);
  });
});
