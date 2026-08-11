// PM2 process file for the VPS. Start with: pm2 start ecosystem.config.js
//
// Secrets and the database path come from /home/griljor/health-data/.env, which
// lives outside the repo so a redeploy can never overwrite it. Config reads that
// file via ENV_FILE, so nothing sensitive appears here or in git.

const ENV_FILE = process.env.HEALTH_ENV_FILE ?? '/home/griljor/health-data/.env';

module.exports = {
  apps: [
    {
      name: 'health',
      script: 'dist/main.js',
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
      instances: 1,
    },
  ],
};
