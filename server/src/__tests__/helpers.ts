import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from '../db';
import { buildApp } from '../app';
import { createUser } from '../auth';

export const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long';

export function testDb(): Db {
  return openDatabase(':memory:');
}

export function testApp(db: Db): FastifyInstance {
  return buildApp({ db, sessionSecret: TEST_SECRET, isProduction: false, logger: false });
}

/** Create a user and return a Cookie header string for an authenticated session. */
export async function loginAs(
  app: FastifyInstance,
  db: Db,
  username: string,
  password = 'correct-horse',
): Promise<{ userId: number; cookie: string }> {
  const user = await createUser(db, username, password);

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });

  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error(`login failed: ${res.statusCode} ${res.body}`);

  return { userId: user.id, cookie: raw.split(';')[0] };
}
