import path from 'path';
import dotenv from 'dotenv';

const REPO_ROOT = path.resolve(__dirname, '../..');

// In production PM2 points ENV_FILE at /home/griljor/health-data/.env, which lives
// outside the repo so a redeploy can never overwrite it. Locally it's just ./.env.
dotenv.config({ path: process.env.ENV_FILE ?? path.join(REPO_ROOT, '.env') });

const isProduction = process.env.NODE_ENV === 'production';

function resolveDbPath(raw: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) {
    // A weak secret in production means forgeable session cookies, so refuse to start
    // rather than come up quietly insecure.
    if (isProduction) {
      throw new Error(
        'SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32',
      );
    }
    return 'dev-only-insecure-secret-do-not-use-in-production';
  }
  return secret;
}

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4300),
  dbPath: resolveDbPath(process.env.DB_PATH ?? './data/app.db'),
  sessionSecret: requireSessionSecret(),
  usdaApiKey: process.env.USDA_API_KEY ?? '',
};
