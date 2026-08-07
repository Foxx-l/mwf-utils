/**
 * tagHandler — nickname formatting, prefix replacement and tag-role sync.
 * Uses plain fakes plus real discord.js Collections, so no API is touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection } = require('discord.js');

delete process.env.ADMIN_LOG_CHANNEL; // keep sendLog a no-op

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-taghandler-'));
process.env.DATA_DIR = dir;           // tagStore seeds OKT + TLL here

const { applyTag, stripTag, buildTaggedNick } = require('../src/handlers/interactions/tagHandler');

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const OKT_ROLE = { id: 'role-okt', name: 'OKT' };
const TLL_ROLE = { id: 'role-tll', name: 'TLL' };
const OTHER_ROLE = { id: 'role-member', name: 'Member' };

/**
 * @param {{ nickname?: string|null, username?: string, globalName?: string|null,
 *           held?: object[], guildRoles?: object[] }} opts
 */
function makeMember({ nickname = null, username = 'Fox', globalName = null, held = [], guildRoles = [OKT_ROLE, TLL_ROLE, OTHER_ROLE] } = {}) {
  const heldRoles = new Collection(held.map(r => [r.id, r]));
  return {
    id: 'member-1',
    nickname,
    displayName: nickname ?? globalName ?? username,
    user: {
      globalName,
      username,
      tag: `${username}#0001`,
      displayAvatarURL: () => 'https://example.invalid/avatar.png',
    },
    client: {},
    guild: { roles: { cache: new Collection(guildRoles.map(r => [r.id, r])) } },
    roles: {
      cache: heldRoles,
      add: jest.fn(async role => { heldRoles.set(role.id ?? role, role); }),
      remove: jest.fn(async ids => { (Array.isArray(ids) ? ids : [ids]).forEach(id => heldRoles.delete(id)); }),
    },
    setNickname: jest.fn(async () => {}),
  };
}

describe('nickname helpers', () => {
  test('stripTag removes a leading [TAG] prefix only', () => {
    expect(stripTag('[OKT] Fox')).toBe('Fox');
    expect(stripTag('[OKT]Fox')).toBe('Fox');
    expect(stripTag('Fox [OKT]')).toBe('Fox [OKT]');
    expect(stripTag('Fox')).toBe('Fox');
    expect(stripTag(null)).toBe('');
  });

  test('buildTaggedNick fits Discord\'s 32-character limit without cutting the tag', () => {
    expect(buildTaggedNick('OKT', 'Fox')).toBe('[OKT] Fox');

    const long = buildTaggedNick('Greyhounds', 'A'.repeat(40));
    expect(long).toHaveLength(32);
    expect(long.startsWith('[Greyhounds] ')).toBe(true);
  });
});

describe('applyTag', () => {
  test('sets the prefix and grants the matching tag role', async () => {
    const member = makeMember({ held: [OTHER_ROLE] });
    const result = await applyTag(member, 'OKT');

    expect(result).toMatchObject({ ok: true, nickname: '[OKT] Fox', roleName: 'OKT' });
    expect(member.setNickname).toHaveBeenCalledWith('[OKT] Fox', 'Clan tag update');
    expect(member.roles.add).toHaveBeenCalledWith(OKT_ROLE, 'Clan tag change');
    expect(member.roles.remove).not.toHaveBeenCalled();
  });

  test('switching tags replaces the prefix and swaps the tag role', async () => {
    const member = makeMember({ nickname: '[TLL] Fox', held: [TLL_ROLE, OTHER_ROLE] });
    const result = await applyTag(member, 'OKT');

    expect(result.nickname).toBe('[OKT] Fox');
    expect(member.roles.remove).toHaveBeenCalledWith(['role-tll'], 'Clan tag change');
    expect(member.roles.add).toHaveBeenCalledWith(OKT_ROLE, 'Clan tag change');
  });

  test('clearing drops the nickname override entirely and removes tag roles', async () => {
    const member = makeMember({ nickname: '[OKT] Fox', held: [OKT_ROLE] });
    const result = await applyTag(member, null);

    expect(result).toMatchObject({ ok: true, nickname: 'Fox' });
    expect(member.setNickname).toHaveBeenCalledWith(null, 'Clan tag update');
    expect(member.roles.remove).toHaveBeenCalledWith(['role-okt'], 'Clan tag change');
  });

  test('keeps a custom nickname when only the tag is removed', async () => {
    const member = makeMember({ nickname: '[OKT] Foxy', held: [OKT_ROLE] });
    const result = await applyTag(member, null);

    expect(result.nickname).toBe('Foxy');
    expect(member.setNickname).toHaveBeenCalledWith('Foxy', 'Clan tag update');
  });

  test('reports "unchanged" without touching Discord', async () => {
    const member = makeMember({ nickname: '[OKT] Fox', held: [OKT_ROLE] });
    const result = await applyTag(member, 'OKT');

    expect(result).toEqual({ ok: true, unchanged: true, nickname: '[OKT] Fox' });
    expect(member.setNickname).not.toHaveBeenCalled();
  });

  test('a missing tag role changes the nickname and nothing else', async () => {
    const member = makeMember({ guildRoles: [OTHER_ROLE] });
    const result = await applyTag(member, 'OKT');

    expect(result).toMatchObject({ ok: true, nickname: '[OKT] Fox' });
    expect(result.roleName).toBeUndefined();
    expect(result.roleWarning).toBeUndefined();
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  test('a role-hierarchy failure still keeps the nickname change', async () => {
    const member = makeMember();
    member.roles.add.mockRejectedValueOnce(new Error('Missing Permissions'));
    const result = await applyTag(member, 'OKT');

    expect(result.ok).toBe(true);
    expect(result.nickname).toBe('[OKT] Fox');
    expect(result.roleWarning).toMatch(/could not update the matching tag role/);
  });

  test('a nickname permission error is reported and no roles are touched', async () => {
    const member = makeMember();
    member.setNickname.mockRejectedValueOnce(Object.assign(new Error('Missing Permissions'), { code: 50013 }));
    const result = await applyTag(member, 'OKT');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not allowed to change that nickname/);
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  test('the audit reason names the admin when one triggered the change', async () => {
    const member = makeMember();
    await applyTag(member, 'OKT', { actorTag: 'Admin#0001' });
    expect(member.setNickname).toHaveBeenCalledWith('[OKT] Fox', 'Clan tag by Admin#0001');
  });
});
