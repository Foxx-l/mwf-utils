/**
 * The shared visual vocabulary: status glyphs, the confirm dialog, and the
 * Server Details embed that three code paths publish.
 *
 * These assertions pin the *rendered* values, because the point of pulling them
 * into one place was that nothing on screen changes.
 */

const { GLYPHS, statusGlyph, COLORS } = require('../src/config/theme');
const { EMBED_TITLES } = require('../src/config/constants');
const { confirmDialog, createServerDetailsEmbed } = require('../src/utils/embeds');

describe('status glyphs', () => {
  test('are the icons the panel has always used', () => {
    expect(GLYPHS.ok).toBe('🟢');
    expect(GLYPHS.partial).toBe('🟡');
    expect(GLYPHS.missing).toBe('🔴');
    expect(GLYPHS.idle).toBe('⚪');
  });

  test('statusGlyph reads none / some / all', () => {
    expect(statusGlyph(0, 2)).toBe(GLYPHS.missing);
    expect(statusGlyph(1, 2)).toBe(GLYPHS.partial);
    expect(statusGlyph(2, 2)).toBe(GLYPHS.ok);
  });

  test('an unconfigured feature (total 0) is missing, not complete', () => {
    expect(statusGlyph(0, 0)).toBe(GLYPHS.missing);
  });
});

describe('confirmDialog', () => {
  const payload = confirmDialog({
    title: 'Confirm Role Reset',
    description: 'This will remove **all Allies and Axis roles** from every member.\n\nAre you sure?',
    confirmId: 'admin_reset_confirm',
    cancelId: 'admin_reset_cancel',
  });
  const embed = payload.embeds[0].toJSON();
  const buttons = payload.components[0].toJSON().components;

  test('keeps the destructive red the three call sites used', () => {
    expect(embed.color).toBe(0xff0000);
    expect(COLORS.danger).toBe(0xff0000);
  });

  test('prefixes the warning sign and keeps the description verbatim', () => {
    expect(embed.title).toBe('⚠️ Confirm Role Reset');
    expect(embed.description).toContain('Are you sure?');
  });

  test('wires Confirm as danger and Cancel as secondary', () => {
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ custom_id: 'admin_reset_confirm', label: 'Confirm', style: 4 });
    expect(buttons[1]).toMatchObject({ custom_id: 'admin_reset_cancel', label: 'Cancel', style: 2 });
  });

  test('labels can be overridden, as the signups cancel does', () => {
    const signups = confirmDialog({
      title: 'Cancel Signups',
      description: 'gone forever',
      confirmId: 'admin_signups_cancel_confirm',
      cancelId: 'admin_signups_cancel_cancel',
      confirmLabel: 'Delete events',
      cancelLabel: 'Keep them',
    });
    const labels = signups.components[0].toJSON().components.map(b => b.label);
    expect(labels).toEqual(['Delete events', 'Keep them']);
  });
});

describe('createServerDetailsEmbed', () => {
  test('titles per server, and falls back to the legacy single-server title', () => {
    expect(createServerDetailsEmbed('S1', 'HCIA EU 1', 'pw').toJSON().title).toBe('Server Details (S1)');
    expect(createServerDetailsEmbed(null, 'HCIA EU 1', 'pw').toJSON().title).toBe('Server Details');
    expect(EMBED_TITLES.serverDetails('S2')).toBe('Server Details (S2)');
  });

  test('renders the name/password fields the edit flow reads back', () => {
    const fields = createServerDetailsEmbed('S2', 'HCIA EU 2', 'MWFTIME').toJSON().fields;
    expect(fields.map(f => f.value)).toEqual(['HCIA EU 2', 'MWFTIME']);
    // handleLineupEditServer recovers values by matching these names.
    expect(fields[0].name).toContain('Server Name');
    expect(fields[1].name).toContain('Password');
    expect(fields.every(f => f.inline)).toBe(true);
  });
});
