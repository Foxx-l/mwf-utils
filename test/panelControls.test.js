/**
 * The panel's controls: what an environment is allowed to offer, and the
 * guarantee that everything offered actually goes somewhere.
 */

const ALL_ENV = {
  FACTION_CHANNEL: 'faction-ch',
  LINEUP_CHANNEL: 'lineup-ch',
  SERVER_DETAILS_CHANNEL: 'srv-ch',
  MAP_ROTATION_CHANNEL: 'rot-ch',
  NODES_CHANNELS: 'n1,n2',
  MIDCAP_CHANNEL: 'midcap-ch',
  RAIDHELPER_API_KEY: 'key',
  ADMIN_LOG_CHANNEL: 'log-ch',
};

const savedEnv = { ...process.env };

/** Applies exactly the given env, dropping every key ALL_ENV knows about. */
function setEnv(env) {
  for (const key of Object.keys(ALL_ENV)) delete process.env[key];
  Object.assign(process.env, env);
}

afterEach(() => {
  process.env = { ...savedEnv };
});

const controls = require('../src/panel/controls');
const router = require('../src/events/interactionCreate');

/** Every rendered row as `{ id, values }`. */
function rendered() {
  return controls.buildPanelComponents().map(row => {
    const select = row.toJSON().components[0];
    return { id: select.custom_id, values: select.options.map(o => o.value) };
  });
}

function valuesOf(id) {
  return rendered().find(row => row.id === id)?.values ?? [];
}

describe('a fully configured guild', () => {
  beforeEach(() => setEnv(ALL_ENV));

  test('renders all five menus, within Discord’s limits', () => {
    const rows = rendered();
    expect(rows).toHaveLength(5);
    expect(rows.length).toBeLessThanOrEqual(controls.MAX_ROWS);
    for (const row of rows) {
      expect(row.values.length).toBeGreaterThan(0);
      expect(row.values.length).toBeLessThanOrEqual(controls.MAX_OPTIONS);
    }
  });

  test('offers the actions it always has', () => {
    expect(valuesOf('admin_faction_select')).toEqual(['reload', 'reset']);
    expect(valuesOf('admin_server_select')).toEqual(['post:S1', 'post:S2', 'edit:S1', 'edit:S2']);
    expect(valuesOf('admin_panel_select')).toEqual(
      ['refresh', 'postall', 'midcap', 'signups', 'healthcheck', 'clearlogs']
    );
  });
});

describe('gating', () => {
  test('an unconfigured feature offers nothing', () => {
    setEnv({ ...ALL_ENV, NODES_CHANNELS: undefined });
    delete process.env.NODES_CHANNELS;
    const rotnodes = valuesOf('admin_rotnodes_select');
    expect(rotnodes).not.toContain('nodes:post');
    expect(rotnodes).not.toContain('nodes:edit');
    // …and its neighbour in the same menu is untouched.
    expect(rotnodes).toContain('rotation:sync');
  });

  test('mid cap and signups drop out with their own env', () => {
    setEnv({ ...ALL_ENV });
    delete process.env.MIDCAP_CHANNEL;
    delete process.env.RAIDHELPER_API_KEY;
    const panel = valuesOf('admin_panel_select');
    expect(panel).not.toContain('midcap');
    expect(panel).not.toContain('signups');
  });

  test('clear logs needs a log channel', () => {
    setEnv({ ...ALL_ENV });
    delete process.env.ADMIN_LOG_CHANNEL;
    expect(valuesOf('admin_panel_select')).not.toContain('clearlogs');
  });

  test('a whitespace-only value counts as unset', () => {
    setEnv({ ...ALL_ENV, MIDCAP_CHANNEL: '   ' });
    expect(valuesOf('admin_panel_select')).not.toContain('midcap');
  });

  test('a bare guild keeps the diagnostics and drops the empty rows', () => {
    setEnv({});
    const rows = rendered();
    // Nothing is configured, so only the menu with never-gated options survives.
    expect(rows.map(r => r.id)).toEqual(['admin_faction_select', 'admin_panel_select']);
    expect(valuesOf('admin_faction_select')).toEqual(['reset']);
    expect(valuesOf('admin_panel_select')).toEqual(['refresh', 'postall', 'healthcheck']);
  });
});

describe('controls and routes cannot drift apart', () => {
  beforeEach(() => setEnv(ALL_ENV));

  test('every offered action resolves to a real route', () => {
    for (const { id, values } of rendered()) {
      for (const value of values) {
        const route = router.findRoute(router.SELECT_ROUTES, id, value);
        expect(route).not.toBeNull();
        expect(typeof route.run).toBe('function');
      }
    }
  });

  test('every panel select route is reachable from some control', () => {
    const offered = new Set(rendered().flatMap(({ id, values }) => values.map(v => `${id}|${v}`)));
    const unreachable = router.SELECT_ROUTES
      .filter(route => controls.PANEL_CONTROL_IDS.has(route.id))
      .filter(route => ![...offered].some(key => {
        const [id, value] = key.split('|');
        return id === route.id
          && (route.value ? route.value === value : value.startsWith(route.valuePrefix));
      }))
      .map(route => `${route.id}|${route.value ?? route.valuePrefix}`);

    expect(unreachable).toEqual([]);
  });

  test('PANEL_CONTROL_IDS is exactly the set of menus on the panel message', () => {
    expect([...controls.PANEL_CONTROL_IDS].sort()).toEqual(controls.MENUS.map(m => m.id).sort());
  });
});
