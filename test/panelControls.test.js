/**
 * The panel's controls: what an environment is allowed to offer, and the
 * guarantee that everything offered actually goes somewhere.
 *
 * Both layouts are covered. The embed keeps all five menus because it has no
 * buttons; the container has four, because each feature's obvious action moved
 * onto its own row as a button.
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

/** Every rendered row of a layout as `{ id, values }`. */
function rendered(menus = controls.MENUS_V1) {
  return controls.buildPanelComponents(menus).map(row => {
    const select = row.toJSON().components[0];
    return { id: select.custom_id, values: select.options.map(o => o.value) };
  });
}

function valuesOf(id, menus) {
  return rendered(menus).find(row => row.id === id)?.values ?? [];
}

describe('a fully configured guild', () => {
  beforeEach(() => setEnv(ALL_ENV));

  test('the embed layout renders five menus, within Discord’s limits', () => {
    const rows = rendered();
    expect(rows.map(r => r.id)).toEqual([
      'admin_faction_select', 'admin_lineup_select', 'admin_server_select',
      'admin_rotnodes_select', 'admin_panel_select',
    ]);
    expect(rows.length).toBeLessThanOrEqual(controls.MAX_ROWS);
    for (const row of rows) {
      expect(row.values.length).toBeGreaterThan(0);
      expect(row.values.length).toBeLessThanOrEqual(controls.MAX_OPTIONS);
    }
  });

  test('the container layout renders four single-purpose menus', () => {
    // Four selects plus the button row is five component rows — the documented
    // cap, which the container layout stays inside.
    const rows = rendered(controls.MENUS_V2);
    expect(rows.map(r => r.id)).toEqual([
      'admin_content_select', 'admin_rotation_select', 'admin_signups_select', 'admin_danger_select',
    ]);
    expect(rows.length + 1).toBeLessThanOrEqual(controls.MAX_ROWS);
  });

  test('the container drops the actions that became buttons', () => {
    const everyValue = rendered(controls.MENUS_V2).flatMap(r => r.values);
    for (const promoted of ['reload', 'rotation:sync', 'nodes:post', 'midcap', 'refresh', 'postall', 'healthcheck']) {
      expect(everyValue).not.toContain(promoted);
    }
    // …and the ones that stay are the parameterised, rare and destructive ones.
    expect(valuesOf('admin_content_select', controls.MENUS_V2)).toContain('server:post:S1');
    expect(valuesOf('admin_danger_select', controls.MENUS_V2)).toEqual(['faction:reset', 'clearlogs']);
  });

  test('the embed layout keeps every action reachable, since it has no buttons', () => {
    const everyValue = rendered().flatMap(r => r.values);
    for (const value of ['reload', 'rotation:sync', 'nodes:post', 'midcap', 'refresh', 'postall', 'healthcheck']) {
      expect(everyValue).toContain(value);
    }
  });
});

describe('gating', () => {
  test('an unconfigured feature offers nothing', () => {
    setEnv(ALL_ENV);
    delete process.env.NODES_CHANNELS;
    const rotnodes = valuesOf('admin_rotnodes_select');
    expect(rotnodes).not.toContain('nodes:post');
    expect(rotnodes).not.toContain('nodes:edit');
    // …and its neighbour in the same menu is untouched.
    expect(rotnodes).toContain('rotation:sync');
  });

  test('mid cap and signups drop out with their own env', () => {
    setEnv(ALL_ENV);
    delete process.env.MIDCAP_CHANNEL;
    delete process.env.RAIDHELPER_API_KEY;
    expect(valuesOf('admin_panel_select')).not.toContain('midcap');
    // The whole signups menu goes with it in the container layout.
    expect(rendered(controls.MENUS_V2).map(r => r.id)).not.toContain('admin_signups_select');
  });

  test('clear logs needs a log channel', () => {
    setEnv(ALL_ENV);
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
    // Nothing is configured, so only menus with never-gated options survive.
    expect(rows.map(r => r.id)).toEqual(['admin_faction_select', 'admin_panel_select']);
    expect(valuesOf('admin_faction_select')).toEqual(['reset']);
    expect(valuesOf('admin_panel_select')).toEqual(['refresh', 'postall', 'healthcheck']);
  });
});

describe('controls and routes cannot drift apart', () => {
  beforeEach(() => setEnv(ALL_ENV));

  test('every offered action resolves to a real route, in both layouts', () => {
    for (const menus of [controls.MENUS_V1, controls.MENUS_V2]) {
      for (const { id, values } of rendered(menus)) {
        for (const value of values) {
          const route = router.findRoute(router.SELECT_ROUTES, id, value);
          expect(route).not.toBeNull();
          expect(typeof route.run).toBe('function');
        }
      }
    }
  });

  test('every panel select route is reachable from some control', () => {
    const offered = [controls.MENUS_V1, controls.MENUS_V2]
      .flatMap(menus => rendered(menus))
      .flatMap(({ id, values }) => values.map(value => ({ id, value })));

    const unreachable = router.SELECT_ROUTES
      .filter(route => controls.PANEL_CONTROL_IDS.has(route.id))
      // `legacy` routes are deliberately unreachable: they only serve panels
      // that were open before the deploy.
      .filter(route => !route.legacy)
      .filter(route => !offered.some(({ id, value }) => id === route.id
        && (route.value ? route.value === value : value.startsWith(route.valuePrefix))))
      .map(route => `${route.id}|${route.value ?? route.valuePrefix}`);

    expect(unreachable).toEqual([]);
  });

  test('PANEL_CONTROL_IDS covers every control the panel can render', () => {
    // Whatever sits on the panel message must be listed, or its interaction
    // cannot redraw the panel (and reportPanelResult would overwrite it).
    const expected = [
      ...controls.MENUS_V1.map(m => m.id),
      ...controls.MENUS_V2.map(m => m.id),
      ...controls.SECTION_ACTIONS.map(a => a.customId),
      ...controls.UTILITY_BUTTONS.map(b => b.customId),
    ].sort();
    expect([...controls.PANEL_CONTROL_IDS].sort()).toEqual([...new Set(expected)].sort());
  });

  test('every panel button resolves to a button route, not the catch-all', () => {
    const buttonIds = [
      ...controls.SECTION_ACTIONS.map(a => a.customId),
      ...controls.UTILITY_BUTTONS.map(b => b.customId),
    ];
    for (const id of buttonIds) {
      const route = router.findRoute(router.BUTTON_ROUTES, id);
      expect(route).not.toBeNull();
      // The catch-all matches by prefix; a real route matches by exact id.
      expect(route.id).toBe(id);
      expect(route.admin).toBe(true);
    }
  });
});
