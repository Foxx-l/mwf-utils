// @ts-check
/**
 * payload.js — Assembles the `/panel` message: probe, build the view, hand it to
 * a renderer. The one place that knows what a panel message looks like, so the
 * command, the refresh and "post all missing" all show the same thing.
 *
 * It is also the only place that attaches `MessageFlags.IsComponentsV2`. That
 * flag has to be present on the initial reply *and on every edit*, and nothing
 * carries it forward for you — a dropped flag comes back as a bare 400, so it
 * gets exactly one home.
 */

const { MessageFlags } = require('discord.js');

const { loadLastAction } = require('../utils/lastActionStore');
const { getNextResetTime } = require('../utils/scheduler');
const { probePanelState } = require('./probes');
const { idleFeatures, listMissingEnv } = require('./features');
const { statusRows, metaLines } = require('./rows');
const { renderPanelV1 } = require('./render.v1');
const { renderPanelV2 } = require('./render.v2');
const pkg = require('../../package.json');

const PROCESS_STARTED_AT_MS = Date.now();

function humanizeAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Version, how long this process has been up, and the last admin action.
 * ("up", not "deployed": the clock starts when the process starts.)
 */
function buildFooter(now = Date.now()) {
  const base = `v${pkg.version}  •  up ${humanizeAgo(now - PROCESS_STARTED_AT_MS)}`;
  const last = loadLastAction();
  if (!last) return base;
  const who = last.userTag || `@${last.userId}`;
  return `${base}  •  last: ${last.action} by ${who} ${humanizeAgo(now - last.ts)} ago`;
}

/** Is the container layout switched on? */
function useComponentsV2() {
  return String(process.env.PANEL_V2 ?? '').trim() === '1';
}

/**
 * Everything the renderers need, and nothing about how it looks.
 */
async function collectPanelView(client, guildId) {
  const probe = await probePanelState(client);
  return {
    rows: statusRows(probe, guildId),
    meta: metaLines({
      nextReset: getNextResetTime(),
      idle: idleFeatures(),
      missingEnv: listMissingEnv(),
    }),
    footer: buildFooter(),
  };
}

async function buildPanelPayload(client, guildId) {
  const view = await collectPanelView(client, guildId);
  if (!useComponentsV2()) return renderPanelV1(view);

  return /** @type {import('discord.js').InteractionEditReplyOptions} */ ({
    ...renderPanelV2(view),
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = {
  humanizeAgo,
  buildFooter,
  useComponentsV2,
  collectPanelView,
  buildPanelPayload,
};
