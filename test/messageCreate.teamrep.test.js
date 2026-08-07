const { assignTeamRep } = require('../src/events/messageCreate.teamrep');

describe('assignTeamRep', () => {
  test('returns missing_role when role not in guild', async () => {
    const message = { guild: { roles: { cache: new Map() }, members: { fetch: jest.fn() } }, client: { user: { id: 'bot-id' } } };
    const member = { roles: { cache: new Map(), add: jest.fn() } };
    const res = await assignTeamRep(message, member, 'nonexistent-role-id');
    expect(res.fatal).toBe(true);
    expect(res.reason).toBe('missing_role');
  });

  test('returns role_hierarchy when bot role is too low', async () => {
    const role = { id: 'r1', position: 100 };
    const rolesMap = new Map([['r1', role]]);
    const guild = {
      roles: { cache: rolesMap },
      members: { fetch: jest.fn().mockImplementation(id => {
        if (id === 'bot-id') return Promise.resolve({ roles: { highest: { position: 50 } } });
        return Promise.resolve(null);
      })}
    };
    const message = { guild, client: { user: { id: 'bot-id' } } };
    const member = { roles: { cache: new Map(), add: jest.fn() } };
    const res = await assignTeamRep(message, member, 'r1');
    expect(res.fatal).toBe(true);
    expect(res.reason).toBe('role_hierarchy');
  });

  test('retries transient error then succeeds', async () => {
    const role = { id: 'r1', position: 0 };
    const rolesMap = new Map([['r1', role]]);
    const guild = {
      roles: { cache: rolesMap },
      members: { fetch: jest.fn().mockResolvedValue({ roles: { highest: { position: 100 } } }) }
    };
    const message = { guild, client: { user: { id: 'bot-id' } } };
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
    const res = await assignTeamRep(message, member, 'r1');
    expect(res.success).toBe(true);
    expect(res.attempts).toBeGreaterThanOrEqual(2);
  });
});
