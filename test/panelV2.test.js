/**
 * The container layout.
 *
 * discord.js validates almost none of the Components V2 rules — an illegal tree
 * serialises happily and comes back as a bare 400 from Discord — so the rules
 * are asserted here instead: no embeds, the flag present, one accessory per
 * section, and the component budget respected.
 */

const { MessageFlags, ComponentType } = require('discord.js');

const ALL_ENV = {
  GUILD_ID: 'g1',
  FACTION_CHANNEL: 'faction-ch',
  LINEUP_CHANNEL: 'lineup-ch',
  SERVER_DETAILS_CHANNEL: 'srv-ch',
  MAP_ROTATION_CHANNEL: 'rot-ch',
  NODES_CHANNELS: 'n1,n2',
  MIDCAP_CHANNEL: 'midcap-ch',
  RAIDHELPER_API_KEY: 'key',
  ADMIN_LOG_CHANNEL: 'log-ch',
  SERVER_S1_NAME: 'S1', SERVER_S1_PASSWORD: 'p',
  SERVER_S2_NAME: 'S2', SERVER_S2_PASSWORD: 'p',
};

const savedEnv = { ...process.env };

const { renderPanelV2 } = require('../src/panel/render.v2');
const { countComponents, MAX_COMPONENTS } = require('../src/panel/budget');
const { SECTION_ACTIONS } = require('../src/panel/controls');

/** A view with one row per feature, as a fully-configured guild would produce. */
function view() {
  return {
    rows: [
      { key: 'faction',  group: 'embeds',   text: '🛡️ **Faction Embed**   🟢', states: ['ok'] },
      { key: 'lineup',   group: 'embeds',   text: '📋 **Lineup**   S1 🟢 • S2 🔴', states: ['ok', 'missing'] },
      { key: 'server',   group: 'embeds',   text: '🖥️ **Server Details**   S1 🟢 • S2 🟢', states: ['ok', 'ok'] },
      { key: 'rotation', group: 'embeds',   text: '🗺️ **Map Rotation**   🟢', states: ['ok'] },
      { key: 'nodes',    group: 'embeds',   text: '📍 **Nodes**   🟡', states: ['partial'] },
      { key: 'midcap',   group: 'matchday', text: '📊 **Mid Cap Poll**   🔴', states: ['missing'] },
      { key: 'signups',  group: 'matchday', text: '📅 **Signups**   🟡', states: ['partial'] },
    ],
    meta: ['⏰ **Auto-Reset**   <t:1:R>'],
    footer: 'v2.8.0  •  up 3h',
  };
}

beforeEach(() => {
  for (const key of Object.keys(ALL_ENV)) delete process.env[key];
  Object.assign(process.env, ALL_ENV);
});

afterEach(() => {
  process.env = { ...savedEnv };
});

function container() {
  return renderPanelV2(view()).components[0].toJSON();
}

describe('the container', () => {
  test('carries no embeds and no content', () => {
    const payload = renderPanelV2(view());
    expect(payload.embeds).toBeUndefined();
    expect(payload.content).toBeUndefined();
    expect(payload.components).toHaveLength(1);
  });

  test('is a Container with the brand accent instead of an embed stripe', () => {
    const json = container();
    expect(json.type).toBe(ComponentType.Container);
    expect(json.accent_color).toBe(0x071321);
  });

  test('leads with the title and the summary in one text display', () => {
    const first = container().components[0];
    expect(first.type).toBe(ComponentType.TextDisplay);
    expect(first.content).toContain('## ⚙️  Admin Panel');
    expect(first.content).toContain('posted');
  });

  test('gives every feature with a one-click action its own section and button', () => {
    const sections = container().components.filter(c => c.type === ComponentType.Section);
    expect(sections).toHaveLength(SECTION_ACTIONS.length);

    const buttonIds = sections.map(s => s.accessory.custom_id).sort();
    expect(buttonIds).toEqual(SECTION_ACTIONS.map(a => a.customId).sort());
  });

  test('every section holds 1–3 text displays and exactly one accessory', () => {
    // The one V2 rule the builders do check — but only at toJSON time, so a
    // renderer change that breaks it should fail here, not in production.
    for (const section of container().components.filter(c => c.type === ComponentType.Section)) {
      expect(section.components.length).toBeGreaterThanOrEqual(1);
      expect(section.components.length).toBeLessThanOrEqual(3);
      expect(section.accessory).toBeDefined();
      expect(section.accessory.type).toBe(ComponentType.Button);
    }
  });

  test('pair rows stay plain text, because one button cannot serve S1 and S2', () => {
    const texts = container().components
      .filter(c => c.type === ComponentType.TextDisplay)
      .map(c => c.content)
      .join('\n');
    expect(texts).toContain('**Lineup**');
    expect(texts).toContain('**Server Details**');
  });

  test('ends with the select rows and the diagnostics buttons', () => {
    const rows = container().components.filter(c => c.type === ComponentType.ActionRow);
    const last = rows[rows.length - 1];
    expect(last.components.map(b => b.custom_id)).toEqual([
      'admin_panel_refresh', 'admin_healthcheck_run', 'admin_postall',
    ]);
    // …and every other row is a select menu.
    for (const row of rows.slice(0, -1)) {
      expect(row.components[0].type).toBe(ComponentType.StringSelect);
    }
  });

  test('puts the legend and footer in subtext, the container’s stand-in for a footer', () => {
    const contents = container().components
      .filter(c => c.type === ComponentType.TextDisplay)
      .map(c => c.content);
    const subtext = contents.find(c => c.startsWith('-# '));
    expect(subtext).toContain('posted');
    expect(subtext).toContain('v2.8.0');
  });
});

describe('the component budget', () => {
  test('the rendered panel fits, with room to spare', () => {
    const total = countComponents(renderPanelV2(view()).components);
    expect(total).toBeLessThanOrEqual(MAX_COMPONENTS);
    // Keep a little headroom: the next feature row costs three.
    expect(total).toBeLessThanOrEqual(MAX_COMPONENTS - 3);
  });

  test('counting includes nested components and section accessories', () => {
    // Container + text + section + its text + its button = 5.
    const tree = [{
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: 'x' },
        {
          type: ComponentType.Section,
          components: [{ type: ComponentType.TextDisplay, content: 'y' }],
          accessory: { type: ComponentType.Button, custom_id: 'b' },
        },
      ],
    }];
    expect(countComponents(tree)).toBe(5);
  });

  test('an over-budget tree is refused before Discord sees it', () => {
    const { assertBudget } = require('../src/panel/budget');
    const fat = [{
      type: ComponentType.Container,
      components: Array.from({ length: MAX_COMPONENTS }, () => ({ type: ComponentType.TextDisplay, content: 'x' })),
    }];
    expect(() => assertBudget(fat)).toThrow(/components; Discord allows 40/);
  });
});

describe('the V2 flag', () => {
  test('payload.js attaches it, since a dropped flag is a bare 400', async () => {
    jest.resetModules();
    process.env.PANEL_V2 = '1';
    const payload = require('../src/panel/payload');
    const client = { user: { id: 'bot' }, channels: { fetch: async () => null } };

    const result = await payload.buildPanelPayload(client, 'g1');

    expect(result.flags).toBe(MessageFlags.IsComponentsV2);
    expect(result.embeds).toBeUndefined();
    delete process.env.PANEL_V2;
  });

  test('without PANEL_V2 the classic embed is sent, with no flag', async () => {
    jest.resetModules();
    delete process.env.PANEL_V2;
    const payload = require('../src/panel/payload');
    const client = { user: { id: 'bot' }, channels: { fetch: async () => null } };

    const result = await payload.buildPanelPayload(client, 'g1');

    expect(result.flags).toBeUndefined();
    expect(result.embeds).toHaveLength(1);
  });
});
