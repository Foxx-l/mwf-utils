const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Wednesday 2026-08-12 10:00 UTC = 12:00 Europe/Warsaw (CEST) — before the
 * default 20:00 event time, so "next match" is still that same Wednesday.
 */
const WED_NOON = new Date('2026-08-12T10:00:00Z');
const WED_LATE = new Date('2026-08-12T20:30:00Z'); // 22:30 Warsaw, past kick-off
const THURSDAY = new Date('2026-08-13T10:00:00Z');

describe('signupHandler', () => {
  let handler;
  let store;
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-signup-h-'));
    process.env.DATA_DIR = dir;
    jest.resetModules();
    handler = require('../src/handlers/interactions/signupHandler');
    store = require('../src/utils/signupStore');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.SIGNUP_MATCH_DAY;
    delete process.env.SIGNUP_LEAD_DAYS;
    jest.restoreAllMocks();
  });

  function seedTags(tags) {
    fs.writeFileSync(path.join(dir, 'tags_data.json'), JSON.stringify({ tags }), 'utf8');
  }

  describe('signupChannelName', () => {
    test('lowercases and slugs the tag', () => {
      expect(handler.signupChannelName('OKT')).toBe('signup-okt');
      expect(handler.signupChannelName('75th RR')).toBe('signup-75th-rr');
      expect(handler.signupChannelName('ÖKT?')).toBe('signup-kt');
    });

    test('falls back for tags that slug to nothing', () => {
      expect(handler.signupChannelName('ÄÖÜ')).toBe('signup-clan');
    });
  });

  describe('nextMatchDate', () => {
    test('a Wednesday before kick-off is still the match day', () => {
      expect(handler.nextMatchDate(WED_NOON).date).toBe('2026-08-12');
    });

    test('a Wednesday after kick-off rolls to next week', () => {
      expect(handler.nextMatchDate(WED_LATE).date).toBe('2026-08-19');
    });

    test('a Thursday points at the following Wednesday', () => {
      expect(handler.nextMatchDate(THURSDAY).date).toBe('2026-08-19');
    });

    test('SIGNUP_MATCH_DAY overrides the weekday', () => {
      process.env.SIGNUP_MATCH_DAY = '5'; // Friday
      expect(handler.nextMatchDate(THURSDAY).date).toBe('2026-08-14');
    });
  });

  describe('autoPostDue', () => {
    test('off switch wins', () => {
      seedTags(['OKT']);
      expect(handler.autoPostDue(THURSDAY)).toEqual({ due: false, reason: 'auto-post is off' });
    });

    test('due when enabled and nothing is posted yet', () => {
      seedTags(['OKT']);
      store.setAutoPost(true);
      const check = handler.autoPostDue(THURSDAY);
      expect(check.due).toBe(true);
      expect(check.match.date).toBe('2026-08-19');
    });

    test('not due when every clan and solo already have an event', () => {
      seedTags(['OKT', 'TLL']);
      store.setAutoPost(true);
      for (const key of ['OKT', 'TLL', store.SOLO_KEY]) {
        store.recordEvent('2026-08-19', key, { id: `ev-${key}`, channelId: 'ch' });
      }
      const check = handler.autoPostDue(THURSDAY);
      expect(check.due).toBe(false);
      expect(check.reason).toContain('already posted');
    });

    test('a partially posted date is still due', () => {
      seedTags(['OKT', 'TLL']);
      store.setAutoPost(true);
      store.recordEvent('2026-08-19', 'OKT', { id: 'ev1', channelId: 'ch' });
      expect(handler.autoPostDue(THURSDAY).due).toBe(true);
    });

    test('outside the lead window nothing is posted', () => {
      seedTags(['OKT']);
      store.setAutoPost(true);
      process.env.SIGNUP_LEAD_DAYS = '2'; // Thursday → next Wed is 6 days out
      const check = handler.autoPostDue(THURSDAY);
      expect(check.due).toBe(false);
      expect(check.reason).toContain('lead');
    });
  });

  describe('postSignups', () => {
    /** Minimal guild fake covering ensureStructure + postSignups. */
    function makeGuild() {
      const channels = new Map();
      let nextId = 100;
      const guild = {
        id: 'guild1',
        roles: {
          everyone: { id: 'everyone' },
          cache: { find: fn => [{ name: 'OKT', id: 'role-okt' }].find(fn) },
        },
        members: { me: { id: 'bot' } },
        client: { user: { id: 'bot' } },
        channels: {
          fetch: jest.fn().mockResolvedValue(null),
          cache: {
            get: id => channels.get(id) ?? null,
            find: fn => [...channels.values()].find(fn) ?? null,
          },
          create: jest.fn(async opts => {
            const channel = {
              id: String(nextId++),
              name: opts.name,
              type: opts.type,
              parentId: opts.parent ?? null,
            };
            channels.set(channel.id, channel);
            return channel;
          }),
        },
      };
      return guild;
    }

    test('creates category, per-clan + solo channels, and one event each', async () => {
      seedTags(['OKT', 'TLL']);
      const guild = makeGuild();
      const raidhelper = require('../src/utils/raidhelper');
      let ev = 0;
      jest.spyOn(raidhelper, 'createEvent').mockImplementation(async () => ({ id: `ev${++ev}` }));

      const match = { date: '2026-08-19' };
      const { results } = await handler.postSignups(guild, match, { leaderId: 'admin1' });

      expect(results.map(r => r.status)).toEqual(['created', 'created', 'created']);
      expect(raidhelper.createEvent).toHaveBeenCalledTimes(3);
      // idempotent: a second run skips everything
      const again = await handler.postSignups(guild, match, { leaderId: 'admin1' });
      expect(again.results.map(r => r.status)).toEqual(['skipped', 'skipped', 'skipped']);
      expect(raidhelper.createEvent).toHaveBeenCalledTimes(3);
    });

    test('a failed create is reported but does not block the others', async () => {
      seedTags(['OKT', 'TLL']);
      const guild = makeGuild();
      const raidhelper = require('../src/utils/raidhelper');
      jest.spyOn(raidhelper, 'createEvent')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ id: 'ev-ok' });

      const { results } = await handler.postSignups(guild, { date: '2026-08-19' }, { leaderId: 'a' });
      expect(results.map(r => r.status).sort()).toEqual(['created', 'created', 'failed']);
      // the failed clan is not recorded, so a retry re-attempts only it
      const retry = await handler.postSignups(guild, { date: '2026-08-19' }, { leaderId: 'a' });
      expect(retry.results.filter(r => r.status === 'created')).toHaveLength(1);
    });

    test('warns when a clan role is missing', async () => {
      seedTags(['NOROLE']);
      const guild = makeGuild();
      const raidhelper = require('../src/utils/raidhelper');
      jest.spyOn(raidhelper, 'createEvent').mockResolvedValue({ id: 'ev' });

      const { warnings } = await handler.postSignups(guild, { date: '2026-08-19' }, { leaderId: 'a' });
      expect(warnings.some(w => w.includes('NOROLE'))).toBe(true);
    });
  });

  describe('cancelSignups', () => {
    test('deletes recorded events and clears the store', async () => {
      const raidhelper = require('../src/utils/raidhelper');
      jest.spyOn(raidhelper, 'deleteEvent').mockResolvedValue(true);
      store.recordEvent('2026-08-19', 'OKT', { id: 'ev1', channelId: 'ch1' });
      store.recordEvent('2026-08-19', store.SOLO_KEY, { id: 'ev2', channelId: 'ch2' });

      const results = await handler.cancelSignups('2026-08-19');
      expect(results.map(r => r.status)).toEqual(['deleted', 'deleted']);
      expect(store.eventsForDate('2026-08-19')).toEqual({});
    });

    test('a failed delete keeps the record for a retry', async () => {
      const raidhelper = require('../src/utils/raidhelper');
      jest.spyOn(raidhelper, 'deleteEvent').mockRejectedValue(new Error('api down'));
      store.recordEvent('2026-08-19', 'OKT', { id: 'ev1', channelId: 'ch1' });

      const results = await handler.cancelSignups('2026-08-19');
      expect(results[0].status).toBe('failed');
      expect(store.getEvent('2026-08-19', 'OKT')).not.toBeNull();
    });
  });
});
