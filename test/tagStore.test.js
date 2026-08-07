const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_CLAN_TAGS } = require('../src/config/constants');

describe('tagStore', () => {
  let store;
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwf-tags-'));
    process.env.DATA_DIR = dir;
    jest.resetModules();
    store = require('../src/utils/tagStore');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  /**
   * Writes an explicit tag list so assertions don't depend on which tags
   * happen to be in DEFAULT_CLAN_TAGS — the store re-reads the file per call.
   */
  function seed(tags) {
    fs.writeFileSync(path.join(dir, 'tags_data.json'), JSON.stringify({ tags }), 'utf8');
  }

  test('seeds the default tags when no file exists yet', () => {
    expect(store.loadTags()).toEqual(DEFAULT_CLAN_TAGS);
  });

  test('an emptied list stays empty instead of re-seeding the defaults', () => {
    seed(['OKT', 'TLL']);
    expect(store.removeTag('OKT').ok).toBe(true);
    expect(store.removeTag('TLL').ok).toBe(true);
    expect(store.loadTags()).toEqual([]);
  });

  test('add round-trips and keeps the spelling the admin typed', () => {
    seed(['OKT']);
    expect(store.addTag('  Ratz ')).toEqual({ ok: true, tag: 'Ratz' });
    expect(store.loadTags()).toEqual(['OKT', 'Ratz']);
  });

  test('rejects empty, bracketed and over-long tags', () => {
    seed(['OKT', 'TLL']);
    expect(store.addTag('   ').ok).toBe(false);
    expect(store.addTag('[OKT]').reason).toMatch(/\[/);
    expect(store.addTag('x'.repeat(17)).reason).toMatch(/16 characters/);
    expect(store.loadTags()).toEqual(['OKT', 'TLL']);
  });

  test('duplicates are rejected case-insensitively', () => {
    seed(['OKT']);
    const result = store.addTag('okt');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('OKT');
  });

  test('resolveTag returns the canonical spelling, or null', () => {
    seed(['OKT', 'TLL']);
    expect(store.resolveTag('tll')).toBe('TLL');
    expect(store.resolveTag('  OKT ')).toBe('OKT');
    expect(store.resolveTag('nope')).toBeNull();
    expect(store.resolveTag('')).toBeNull();
    expect(store.resolveTag(undefined)).toBeNull();
  });

  test('remove reports unknown tags and is case-insensitive', () => {
    seed(['OKT', 'TLL']);
    expect(store.removeTag('okt')).toEqual({ ok: true, tag: 'OKT' });
    expect(store.loadTags()).toEqual(['TLL']);
    expect(store.removeTag('OKT').ok).toBe(false);
  });

  test('searchTags filters by substring and caps the result', () => {
    seed(['OKT', 'TLL', 'RATZ']);
    expect(store.searchTags('t')).toEqual(['OKT', 'TLL', 'RATZ']);
    expect(store.searchTags('ll')).toEqual(['TLL']);
    expect(store.searchTags('')).toEqual(['OKT', 'TLL', 'RATZ']);
    expect(store.searchTags('t', 1)).toEqual(['OKT']);
    expect(store.searchTags('zzz')).toEqual([]);
  });

  test('the default list itself is clean (no blanks, brackets or duplicates)', () => {
    // Guards the migrated TagSelector list: the store would silently drop
    // blanks/duplicates, and a `[` would produce a broken `[[X]] Name` prefix.
    expect(store.loadTags()).toEqual(DEFAULT_CLAN_TAGS);
    expect(DEFAULT_CLAN_TAGS.every(t => t.trim() === t && t !== '')).toBe(true);
    expect(DEFAULT_CLAN_TAGS.some(t => /[[\]]/.test(t))).toBe(false);
    expect(DEFAULT_CLAN_TAGS.every(t => t.length <= 16)).toBe(true);
  });

  test('blanks and duplicates in a hand-edited file are ignored on read', () => {
    seed(['OKT', '', 'okt', 'TLL', 42]);
    expect(store.loadTags()).toEqual(['OKT', 'TLL']);
  });

  test('data survives a module reload from disk', () => {
    seed(['OKT']);
    store.addTag('Greyhounds');
    jest.resetModules();
    expect(require('../src/utils/tagStore').loadTags()).toEqual(['OKT', 'Greyhounds']);
  });
});
