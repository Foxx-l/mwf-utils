module.exports = {
  apps: [{
    name: 'mwf-bot',
    script: 'src/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 10,
    min_uptime: '10s',
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
