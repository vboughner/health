// PM2 process file for the VPS. Start with: pm2 start ecosystem.config.js
//
// Secrets and the database path come from /home/griljor/health-data/.env, which
// lives outside the repo so a redeploy can never overwrite it. Config reads that
// file via ENV_FILE, so nothing sensitive appears here or in git.

const path = require('path');

const ENV_FILE = process.env.HEALTH_ENV_FILE ?? '/home/griljor/health-data/.env';

module.exports = {
  apps: [
    {
      name: 'health',
      // Anchored to this file, not to the shell's working directory. PM2 resolves a
      // relative `script` against cwd, so `pm2 start server/ecosystem.config.js` from
      // the repo root looked for <root>/dist/main.js and failed with "Script not
      // found" — after the delete that preceded it, which meant an outage on what was
      // meant to be a restart. Starting it from anywhere now works.
      script: path.join(__dirname, 'dist/main.js'),
      cwd: __dirname,
      // 4300, not 3xxx: griljor holds 3000-3007 here and each local griljor
      // worktree claims the next 3N00.
      env: {
        NODE_ENV: 'production',
        ENV_FILE,
        PORT: 4300,
      },
      max_memory_restart: '300M',
      // The database is SQLite in WAL mode — a second process writing the same
      // file would be asking for trouble. One instance only.
      //
      // exec_mode is explicit because PM2's default is 'fork' only while `instances`
      // is unset; setting it flips the default to 'cluster'. The first deploy came up
      // in cluster mode for exactly that reason — harmless at one instance, but it
      // makes `pm2 scale health 2` a working command rather than an impossible one,
      // which is the thing this comment exists to prevent.
      exec_mode: 'fork',
      instances: 1,
    },
  ],
};
