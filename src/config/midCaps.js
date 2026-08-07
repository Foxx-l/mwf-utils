// @ts-check
/**
 * midCaps.js — The three mid caps (middle strongpoints) of every map. These are
 * the answers offered by the Mid Cap poll.
 *
 * Source: the "MIDWEEK FRONTLINE - DATA" sheet (MAP,MIDCAP columns). Keep the
 * map keys spelled the way the sheet spells them; ALIASES below absorbs the
 * longer in-game names so a rotation event typed as "Sainte-Mère-Église" still
 * resolves. Lookup is accent- and punctuation-insensitive.
 *
 * Adding a map is a single-file change: append its three caps here (plus an
 * alias if the rotation editor is likely to spell it differently).
 */

const MID_CAPS = Object.freeze({
  'Carentan':   ['Canal Crossing', 'Town Center', 'Train Station'],
  'Driel':      ['Brick Factory', 'Railway Bridge', 'Gun Emplacements'],
  'El Alamein': ['Desert Rat Trenches', 'Oasis', 'Valley'],
  'Elsenborn':  ['Road To Elsenborn Ridge', 'Dug Out Tanks', 'Checkpoint'],
  'Foy':        ['West Bend', 'Southern Edge', 'Dugout Barn'],
  'Hill 400':   ['Flak Pits', 'Hill 400', 'Southern Approach'],
  'Hurtgen':    ['North Pass', 'The Scar', 'The Siegfried Line'],
  'Juno':       ['Graye Sur Mer', 'La Suelles River', 'Market Square'],
  'Kharkov':    ['Water Mill', 'St Mary', 'Distillery'],
  'Kursk':      ['The Windmills', 'Yamki', "Oleg's House"],
  'Mortain':    ['Hill 314', 'Petit Chappelle Saint Michel', 'US Southern Roadblock'],
  'Omaha':      ['West Vierville', 'Vierville Sur Mer', 'Artillery Battery'],
  'PHL':        ['Groult Pillbox', 'Carentan Causeway', 'Flak Position'],
  'Remagen':    ['St Severin Chapel', 'Ludendorff Bridge', 'Bauerhof Am Rhein'],
  'SMDM':       ['The Dugout', 'AA Network', "Pierre's Farm"],
  'SME':        ['Hospice', 'Ste Mere Eglise', 'Checkpoint'],
  'Smolensk':   ['Pyatnitskii Overpass', 'Zhelyabova Square', '84th Battalion Bridge'],
  'Stalingrad': ['Railway Crossing', 'Carriage Depot', 'Train Station'],
  'Tobruk':     ['Desert Rat Caves', 'Church Grounds', 'Admirality House'],
  'Utah':       ['WN4', 'The Chapel', 'WN7'],
});

// Alternative spellings → key in MID_CAPS. Both sides are normalized before
// comparison, so casing, accents, hyphens and apostrophes don't matter here.
const ALIASES = Object.freeze({
  'Sainte-Mère-Église': 'SME',
  'Ste Mere Eglise': 'SME',
  'Sainte-Marie-du-Mont': 'SMDM',
  'Ste Marie du Mont': 'SMDM',
  'Purple Heart Lane': 'PHL',
  'Hürtgen Forest': 'Hurtgen',
  'Hurtgen Forest': 'Hurtgen',
  'Elsenborn Ridge': 'Elsenborn',
  'Utah Beach': 'Utah',
  'Omaha Beach': 'Omaha',
  'Juno Beach': 'Juno',
  'Foy Bastogne': 'Foy',
  'Kursk Salient': 'Kursk',
});

// Combining diacritical marks, stripped after NFD so "é" folds to "e" rather
// than being deleted along with the rest of the punctuation below.
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Lowercase, strip accents, drop everything that isn't a letter or digit. */
function normalizeMapName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const LOOKUP = new Map();
for (const key of Object.keys(MID_CAPS)) LOOKUP.set(normalizeMapName(key), key);
for (const [alias, key] of Object.entries(ALIASES)) LOOKUP.set(normalizeMapName(alias), key);

/**
 * Canonical map key for a rotation event's (free-text) map name, or null.
 * @param {string|null|undefined} mapName
 * @returns {string|null}
 */
function resolveMap(mapName) {
  const normalized = normalizeMapName(mapName);
  if (!normalized) return null;
  return LOOKUP.get(normalized) ?? null;
}

/**
 * The three mid caps for a map name, or null when the map is unknown.
 * @param {string|null|undefined} mapName
 * @returns {string[]|null}
 */
function getMidCaps(mapName) {
  const key = resolveMap(mapName);
  return key ? [...MID_CAPS[key]] : null;
}

/** Every map key that has mid caps configured. */
function listKnownMaps() {
  return Object.keys(MID_CAPS);
}

module.exports = { MID_CAPS, ALIASES, normalizeMapName, resolveMap, getMidCaps, listKnownMaps };
