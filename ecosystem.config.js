module.exports = {
  apps: [{
    name: 'mwf-bot',
    script: 'src/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    // No max_restarts cap: a community bot should ride out a bad night
    // (Discord outage, bad deploy) instead of staying down permanently.
    restart_delay: 3000,
    exp_backoff_restart_delay: 100,
    min_uptime: '10s',
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
