const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Secret names whose values should be redacted from log output.
// Only strings of at least 8 characters are considered so short values
// like numeric IDs or single-char flags don't trigger false positives.
const SECRET_ENV_KEYS = [
  'BOT_TOKEN',
  'CLIENT_SECRET',
  'WEBHOOK_SECRET',
];

function collectSecretValues() {
  const values = new Set();
  for (const key of SECRET_ENV_KEYS) {
    const v = process.env[key];
    if (v && v.length >= 8) values.add(v);
  }
  // Also redact any env var whose name ends with TOKEN/SECRET/PASSWORD/KEY.
  for (const [key, v] of Object.entries(process.env)) {
    if (!v || v.length < 8) continue;
    if (/_(TOKEN|SECRET|PASSWORD|KEY)$/i.test(key)) values.add(v);
  }
  return values;
}

function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  const values = collectSecretValues();
  if (values.size === 0) return text;
  let out = text;
  for (const v of values) {
    // Split-join avoids regex escaping entirely.
    if (out.includes(v)) out = out.split(v).join('[REDACTED]');
  }
  return out;
}

function safe(message) {
  if (typeof message === 'string') return redactSecrets(message);
  // Non-strings: coerce via String(). Primitives and standard objects are
  // always safe; a pathological toString() would propagate to the caller,
  // the same as if console.log were called on the value directly.
  return redactSecrets(String(message));
}

class Logger {
  info(message) {
    console.log(`${colors.blue}[INFO]${colors.reset} ${safe(message)}`);
  }

  success(message) {
    console.log(`${colors.green}[✓]${colors.reset} ${safe(message)}`);
  }

  warn(message) {
    console.log(`${colors.yellow}[⚠]${colors.reset} ${safe(message)}`);
  }

  error(message, error = null) {
    console.error(`${colors.red}[✗]${colors.reset} ${safe(message)}`);
    if (error) {
      // Error objects may carry secrets in message/stack. Print a redacted
      // view without mutating the caller's Error so surrounding code that
      // re-reads .message / .stack still sees the original.
      if (error instanceof Error) {
        const redactedMessage = redactSecrets(error.message ?? '');
        const redactedStack   = redactSecrets(error.stack ?? '');
        console.error(redactedStack || `${error.name}: ${redactedMessage}`);
      } else {
        console.error(safe(error));
      }
    }
  }

  debug(message) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`${colors.cyan}[DEBUG]${colors.reset} ${safe(message)}`);
    }
  }
}

module.exports = new Logger();
