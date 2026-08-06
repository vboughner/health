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
      // 3000 is the griljor lobby, 3001-3007 are its game servers.
      env: {
        NODE_ENV: 'production',
        ENV_FILE,
        PORT: 3200,
      },
      max_memory_restart: '300M',
      // The database is SQLite in WAL mode — a second process writing the same
      // file would be asking for trouble. One instance only.
      instances: 1,
    },
  ],
};
