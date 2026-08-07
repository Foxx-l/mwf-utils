const { MID_CAPS, getMidCaps, resolveMap, listKnownMaps } = require('../src/config/midCaps');
const { MAP_CYCLE } = require('../src/utils/rotationState');
const { MAX_ANSWER_CHARS, MAX_ANSWERS } = require('../src/utils/midCapPoll');

describe('midCaps config', () => {
  test('every map has exactly three usable caps', () => {
    for (const [map, caps] of Object.entries(MID_CAPS)) {
      expect(caps).toHaveLength(3);
      expect(caps.length).toBeLessThanOrEqual(MAX_ANSWERS);
      expect(caps.every(c => typeof c === 'string' && c.trim() === c && c.length > 0)).toBe(true);
      // Discord truncates poll answers past this, which would mangle the option.
      expect(caps.every(c => c.length <= MAX_ANSWER_CHARS)).toBe(true);
      expect(new Set(caps).size).toBe(3); // no duplicate options on one map
      expect(map.trim()).toBe(map);
    }
  });

  test('every map in the rotation cycle has caps configured', () => {
    // If this fails the poll has no answers for a scheduled match.
    for (const map of MAP_CYCLE) {
      expect(getMidCaps(map)).toHaveLength(3);
    }
  });

  test('lookup ignores case, accents and punctuation', () => {
    expect(resolveMap('carentan')).toBe('Carentan');
    expect(resolveMap('  EL-ALAMEIN ')).toBe('El Alamein');
    expect(resolveMap('hill400')).toBe('Hill 400');
    expect(resolveMap('Sainte-Mère-Église')).toBe('SME');
    expect(resolveMap('ste mere eglise')).toBe('SME');
    expect(resolveMap('Purple Heart Lane')).toBe('PHL');
    expect(resolveMap('Hürtgen Forest')).toBe('Hurtgen');
    expect(resolveMap('Utah Beach')).toBe('Utah');
  });

  test('unknown maps resolve to null rather than guessing', () => {
    expect(resolveMap('Kursk Bulge Extra')).toBeNull();
    expect(resolveMap('')).toBeNull();
    expect(resolveMap(null)).toBeNull();
    expect(getMidCaps('Not A Map')).toBeNull();
  });

  test('getMidCaps returns a copy so callers cannot mutate the config', () => {
    const caps = getMidCaps('Utah');
    caps.push('Tampered');
    expect(getMidCaps('Utah')).toHaveLength(3);
  });

  test('listKnownMaps covers the whole sheet', () => {
    expect(listKnownMaps()).toHaveLength(20);
  });
});
