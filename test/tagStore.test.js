const fs = require('fs');
const os = require('os');
const path = require('path');

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

  test('seeds the default tags when no file exists yet', () => {
    expect(store.loadTags()).toEqual(['OKT', 'TLL']);
  });

  test('an emptied list stays empty instead of re-seeding the defaults', () => {
    expect(store.removeTag('OKT').ok).toBe(true);
    expect(store.removeTag('TLL').ok).toBe(true);
    expect(store.loadTags()).toEqual([]);
  });

  test('add round-trips and keeps the spelling the admin typed', () => {
    expect(store.addTag('  Ratz ')).toEqual({ ok: true, tag: 'Ratz' });
    expect(store.loadTags()).toContain('Ratz');
  });

  test('rejects empty, bracketed and over-long tags', () => {
    expect(store.addTag('   ').ok).toBe(false);
    expect(store.addTag('[OKT]').reason).toMatch(/\[/);
    expect(store.addTag('x'.repeat(17)).reason).toMatch(/16 characters/);
    expect(store.loadTags()).toEqual(['OKT', 'TLL']);
  });

  test('duplicates are rejected case-insensitively', () => {
    const result = store.addTag('okt');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('OKT');
  });

  test('resolveTag returns the canonical spelling, or null', () => {
    expect(store.resolveTag('tll')).toBe('TLL');
    expect(store.resolveTag('  OKT ')).toBe('OKT');
    expect(store.resolveTag('nope')).toBeNull();
    expect(store.resolveTag('')).toBeNull();
    expect(store.resolveTag(undefined)).toBeNull();
  });

  test('remove reports unknown tags and is case-insensitive', () => {
    expect(store.removeTag('okt')).toEqual({ ok: true, tag: 'OKT' });
    expect(store.loadTags()).toEqual(['TLL']);
    expect(store.removeTag('OKT').ok).toBe(false);
  });

  test('searchTags filters by substring and caps the result', () => {
    expect(store.searchTags('t')).toEqual(['OKT', 'TLL']);
    expect(store.searchTags('ll')).toEqual(['TLL']);
    expect(store.searchTags('')).toEqual(['OKT', 'TLL']);
    expect(store.searchTags('t', 1)).toEqual(['OKT']);
    expect(store.searchTags('zzz')).toEqual([]);
  });

  test('blanks and duplicates in a hand-edited file are ignored on read', () => {
    fs.writeFileSync(
      path.join(dir, 'tags_data.json'),
      JSON.stringify({ tags: ['OKT', '', 'okt', 'TLL', 42] }),
      'utf8',
    );
    jest.resetModules();
    expect(require('../src/utils/tagStore').loadTags()).toEqual(['OKT', 'TLL']);
  });

  test('data survives a module reload from disk', () => {
    store.addTag('Greyhounds');
    jest.resetModules();
    expect(require('../src/utils/tagStore').loadTags()).toContain('Greyhounds');
  });
});
