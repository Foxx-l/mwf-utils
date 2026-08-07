function timeValue(name, fallback) {
  const value = String(process.env[name] || fallback).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function getRotationEventTime() {
  return timeValue('ROTATION_EVENT_TIME', '20:00');
}

/**
 * Default server name/password for the Server Details embeds.
 * Per-server env (SERVER_S1_*) wins over the legacy single-server vars
 * (SERVER_*), which win over the built-in placeholders.
 */
function getServerDefaults(server) {
  if (server === 'S1' || server === 'S2') {
    const n = server === 'S1' ? 1 : 2;
    return {
      defaultName: process.env[`SERVER_S${n}_NAME`]     || process.env.SERVER_NAME     || 'HCIA EU ' + n,
      defaultPass: process.env[`SERVER_S${n}_PASSWORD`] || process.env.SERVER_PASSWORD || 'MWFTIME'
    };
  }
  return {
    defaultName: process.env.SERVER_NAME     || 'HCIA EU 1',
    defaultPass: process.env.SERVER_PASSWORD || 'MWFTIME'
  };
}

module.exports = { getRotationEventTime, getServerDefaults };
