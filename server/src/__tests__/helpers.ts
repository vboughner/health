import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { openDatabase, type Db } from '../db';
import { buildApp } from '../app';
import { createUser } from '../auth';
import { nullUsdaClient, type UsdaClient, type UsdaFood } from '../usda';

export const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long';

export function testDb(): Db {
  return openDatabase(':memory:');
}

export function testApp(db: Db, usda: UsdaClient = nullUsdaClient): FastifyInstance {
  return buildApp({ db, usda, sessionSecret: TEST_SECRET, isProduction: false, logger: false });
}

/** A stand-in for USDA that never touches the network. */
export function fakeUsda(results: UsdaFood[]): UsdaClient {
  return {
    configured: true,
    async search() {
      return results;
    },
  };
}

/** A USDA client that always fails, for testing graceful degradation. */
export const brokenUsda: UsdaClient = {
  configured: true,
  async search() {
    throw new Error('USDA search failed (503)');
  },
};

export const USDA_BANANA: UsdaFood = {
  source_id: '1105314',
  name: 'Bananas, raw',
  brand: null,
  serving_desc: null,
  serving_grams: null,
  kcal_per_100g: 89,
  protein_g: 1.09,
  fat_g: 0.33,
  carb_g: 22.8,
  added_sugar_g: null,
  sodium_mg: 1,
  ingredients: null,
};

export const USDA_COOKIE: UsdaFood = {
  source_id: '2001',
  name: 'Chocolate Chip Cookies',
  brand: 'Sample Bakery',
  serving_desc: '2 cookies',
  serving_grams: 32,
  kcal_per_100g: 500,
  protein_g: 5,
  fat_g: 25,
  carb_g: 65,
  added_sugar_g: 35,
  sodium_mg: 420,
  ingredients: 'ENRICHED FLOUR, SUGAR, PARTIALLY HYDROGENATED SOYBEAN OIL, ARTIFICIAL FLAVOR',
};

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

/**
 * Payload and response types for `app.inject`.
 *
 * Annotating the return type is what matters: without it `app.inject(opts)` resolves
 * to the callback overload that returns void, so every `.statusCode` and `.json()`
 * in a suite fails to type-check — which is how a test kept writing a column that
 * had been dropped from the schema.
 */
export type Payload = InjectOptions['payload'];
export type Res = Promise<LightMyRequestResponse>;
