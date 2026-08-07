function timeValue(name, fallback) {
  const value = String(process.env[name] || fallback).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function getRotationEventTime() {
  return timeValue('ROTATION_EVENT_TIME', '20:00');
}

module.exports = { getRotationEventTime };
