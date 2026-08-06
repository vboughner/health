import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  testDb,
  testApp,
  loginAs,
  fakeUsda,
  brokenUsda,
  USDA_BANANA,
  USDA_COOKIE,
} from './helpers';
import type { Db } from '../db';

describe('food logging', () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = testDb();
    app = testApp(db, fakeUsda([USDA_BANANA, USDA_COOKIE]));
    await app.ready();
    ({ cookie } = await loginAs(app, db, 'van'));
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, payload, headers: { cookie } });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  describe('logging a food', () => {
    it('logs a USDA food and computes its nutrition', async () => {
      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 118,
        unit: 'g',
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().entry).toMatchObject({
        food_name: 'Bananas, raw',
        grams: 118,
        kcal: 105,
        protein_g: 1.3,
        carb_g: 26.9,
      });
    });

    it('saves the food so the next log can reference it by id', async () => {
      const first = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 118,
        unit: 'g',
      });
      const foodId = first.json().food.id;

      const second = await post('/api/log/food', { food_id: foodId, quantity: 118, unit: 'g' });

      expect(second.statusCode).toBe(201);
      expect(second.json().entry.kcal).toBe(105);
      expect(db.prepare('SELECT COUNT(*) c FROM foods').get()).toEqual({ c: 1 });
    });

    it('does not duplicate a USDA food already cached', async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 1,
        unit: 'g',
      });
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 1,
        unit: 'g',
      });

      expect(db.prepare('SELECT COUNT(*) c FROM foods').get()).toEqual({ c: 1 });
    });

    it('converts ounces', async () => {
      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 4,
        unit: 'oz',
      });

      expect(res.json().entry.grams).toBeCloseTo(113.4, 1);
    });

    it('converts servings using the food serving size', async () => {
      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_COOKIE },
        quantity: 2,
        unit: 'serving',
      });

      expect(res.json().entry.grams).toBe(64);
      expect(res.json().entry.kcal).toBe(320);
    });

    it('rejects servings for a food with no serving size', async () => {
      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 1,
        unit: 'serving',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/no serving size/);
    });

    it('records the eaten_at time it was given', async () => {
      const when = Date.parse('2026-01-15T18:30:00-08:00');

      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
        eaten_at: when,
      });

      expect(res.json().entry.eaten_at).toBe(when);
      expect(res.json().entry.local_day).toBe('2026-01-15');
    });

    it('assigns the local day, not the UTC one', async () => {
      // 8pm Pacific is already the next day in UTC.
      const evening = Date.parse('2026-01-15T20:00:00-08:00');

      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
        eaten_at: evening,
      });

      expect(res.json().entry.local_day).toBe('2026-01-15');
    });

    it.each([
      ['zero quantity', { quantity: 0, unit: 'g' }],
      ['negative quantity', { quantity: -5, unit: 'g' }],
      ['non-numeric quantity', { quantity: 'lots', unit: 'g' }],
      ['unknown unit', { quantity: 1, unit: 'cups' }],
    ])('rejects %s with 400', async (_label, bad) => {
      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        ...bad,
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects a request with neither food nor food_id', async () => {
      const res = await post('/api/log/food', { quantity: 1, unit: 'g' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/food_id or food/);
    });

    it('404s on an unknown food_id', async () => {
      const res = await post('/api/log/food', { food_id: 9999, quantity: 1, unit: 'g' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('processed-food warnings', () => {
    it('warns when logging a refined food, but still logs it', async () => {
      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_COOKIE },
        quantity: 32,
        unit: 'g',
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().warning).toMatch(/Heads up/);
      expect(res.json().entry.id).toBeDefined();
    });

    it('keeps the flags on the food for next time', async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_COOKIE },
        quantity: 32,
        unit: 'g',
      });

      const recent = await get('/api/foods/recent');
      expect(recent.json().foods[0].processed_flags).toEqual(
        expect.arrayContaining(['high added sugar', 'refined flour']),
      );
    });

    it('does not warn on a whole food', async () => {
      const res = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 118,
        unit: 'g',
      });

      expect(res.json().warning).toBeNull();
    });

    it('shows the flags on the day log entries', async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_COOKIE },
        quantity: 32,
        unit: 'g',
      });

      const day = await get('/api/log/food');
      expect(day.json().entries[0].processed_flags.length).toBeGreaterThan(0);
    });
  });

  describe('reading and deleting the day log', () => {
    it("returns today's entries in the order they were eaten", async () => {
      const noon = Date.parse('2026-01-15T12:00:00-08:00');

      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
        eaten_at: noon + 3_600_000,
      });
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_COOKIE },
        quantity: 32,
        unit: 'g',
        eaten_at: noon,
      });

      const res = await get('/api/log/food?date=2026-01-15');

      expect(res.json().entries.map((e: { food_name: string }) => e.food_name)).toEqual([
        'Chocolate Chip Cookies',
        'Bananas, raw',
      ]);
    });

    it('returns an empty list for a day with nothing logged', async () => {
      const res = await get('/api/log/food?date=2020-01-01');
      expect(res.json().entries).toEqual([]);
    });

    it('deletes an entry', async () => {
      const created = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
      });
      const id = created.json().entry.id;

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/log/food/${id}`,
        headers: { cookie },
      });

      expect(del.statusCode).toBe(204);
      expect((await get('/api/log/food')).json().entries).toEqual([]);
    });

    it('404s deleting an entry that does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/log/food/9999',
        headers: { cookie },
      });

      expect(res.statusCode).toBe(404);
    });

    it('keeps a logged entry readable after its food row is deleted', async () => {
      const created = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 118,
        unit: 'g',
      });

      db.prepare('DELETE FROM foods WHERE id = ?').run(created.json().food.id);

      const entries = (await get('/api/log/food')).json().entries;
      expect(entries[0]).toMatchObject({ food_name: 'Bananas, raw', kcal: 105 });
    });
  });

  describe('history is immutable', () => {
    it('does not rewrite a past entry when the food is re-cached with different numbers', async () => {
      const created = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
      });
      const foodId = created.json().food.id;

      // Simulate USDA revising the food.
      db.prepare('UPDATE foods SET kcal_per_100g = 500 WHERE id = ?').run(foodId);

      const entries = (await get('/api/log/food')).json().entries;
      expect(entries[0].kcal).toBe(89);
    });
  });

  describe('remembered foods', () => {
    it('lists recently logged foods, most recent first', async () => {
      const t = Date.parse('2026-01-15T12:00:00-08:00');

      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
        eaten_at: t,
      });
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_COOKIE },
        quantity: 32,
        unit: 'g',
        eaten_at: t + 1000,
      });

      const res = await get('/api/foods/recent');
      expect(res.json().foods.map((f: { name: string }) => f.name)).toEqual([
        'Chocolate Chip Cookies',
        'Bananas, raw',
      ]);
    });

    it('lists each food once however many times it was logged', async () => {
      for (let i = 0; i < 3; i++) {
        await post('/api/log/food', {
          food: { source: 'usda', ...USDA_BANANA },
          quantity: 100,
          unit: 'g',
        });
      }

      expect((await get('/api/foods/recent')).json().foods).toHaveLength(1);
    });

    it('orders frequent foods by how often they were logged', async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_COOKIE },
        quantity: 32,
        unit: 'g',
      });
      for (let i = 0; i < 3; i++) {
        await post('/api/log/food', {
          food: { source: 'usda', ...USDA_BANANA },
          quantity: 100,
          unit: 'g',
        });
      }

      const res = await get('/api/foods/frequent');
      expect(res.json().foods[0].name).toBe('Bananas, raw');
    });

    it('is empty before anything is logged', async () => {
      expect((await get('/api/foods/recent')).json().foods).toEqual([]);
      expect((await get('/api/foods/frequent')).json().foods).toEqual([]);
    });
  });

  describe('search', () => {
    it('returns USDA results', async () => {
      const res = await get('/api/foods/search?q=banana');

      expect(res.statusCode).toBe(200);
      expect(res.json().usda.map((f: { name: string }) => f.name)).toContain('Bananas, raw');
    });

    it('returns saved foods once they have been logged, and not twice', async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
      });

      const res = await get('/api/foods/search?q=banana');

      expect(res.json().saved.map((f: { name: string }) => f.name)).toContain('Bananas, raw');
      expect(res.json().usda.map((f: { name: string }) => f.name)).not.toContain('Bananas, raw');
    });

    it('needs at least two characters', async () => {
      const res = await get('/api/foods/search?q=b');
      expect(res.json()).toMatchObject({ saved: [], usda: [] });
    });

    it('still returns saved foods when USDA is down', async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
      });

      const brokenApp = testApp(db, brokenUsda);
      await brokenApp.ready();

      const res = await brokenApp.inject({
        method: 'GET',
        url: '/api/foods/search?q=banana',
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().saved).toHaveLength(1);
      expect(res.json().usdaError).toMatch(/503/);

      await brokenApp.close();
    });

    it('reports when no USDA key is configured', async () => {
      const noKeyApp = testApp(db);
      await noKeyApp.ready();

      const res = await noKeyApp.inject({
        method: 'GET',
        url: '/api/foods/search?q=banana',
        headers: { cookie },
      });

      expect(res.json().usdaConfigured).toBe(false);
      await noKeyApp.close();
    });
  });

  describe('manual foods', () => {
    it('creates a food by hand', async () => {
      const res = await post('/api/foods', {
        name: "Mom's lentil soup",
        kcal_per_100g: 60,
        protein_g: 4,
        fat_g: 1,
        carb_g: 9,
        serving_grams: 350,
        serving_desc: '1 bowl',
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().food).toMatchObject({ name: "Mom's lentil soup", source: 'manual' });
    });

    it('can be logged like any other food', async () => {
      const created = await post('/api/foods', {
        name: "Mom's lentil soup",
        kcal_per_100g: 60,
        protein_g: 4,
        fat_g: 1,
        carb_g: 9,
        serving_grams: 350,
      });

      const logged = await post('/api/log/food', {
        food_id: created.json().food.id,
        quantity: 1,
        unit: 'serving',
      });

      expect(logged.json().entry.kcal).toBe(210);
    });

    it('rejects one with no name or no calories', async () => {
      expect((await post('/api/foods', { kcal_per_100g: 60 })).statusCode).toBe(400);
      expect((await post('/api/foods', { name: 'Soup' })).statusCode).toBe(400);
    });
  });

  describe('access control', () => {
    it.each([
      ['GET', '/api/foods/search?q=banana'],
      ['GET', '/api/foods/recent'],
      ['GET', '/api/foods/frequent'],
      ['GET', '/api/log/food'],
      ['POST', '/api/foods'],
      ['POST', '/api/log/food'],
      ['DELETE', '/api/log/food/1'],
    ])('%s %s requires a session', async (method, url) => {
      const res = await app.inject({ method: method as 'GET', url, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('does not show one user the entries of another', async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
      });

      const other = await loginAs(app, db, 'someone-else');

      const res = await app.inject({
        method: 'GET',
        url: '/api/log/food',
        headers: { cookie: other.cookie },
      });

      expect(res.json().entries).toEqual([]);
    });

    it('does not let one user delete the entries of another', async () => {
      const created = await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
      });
      const id = created.json().entry.id;

      const other = await loginAs(app, db, 'someone-else');

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/log/food/${id}`,
        headers: { cookie: other.cookie },
      });

      expect(del.statusCode).toBe(404);
      expect((await get('/api/log/food')).json().entries).toHaveLength(1);
    });

    it("does not surface one user's foods in another's recent list", async () => {
      await post('/api/log/food', {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: 100,
        unit: 'g',
      });

      const other = await loginAs(app, db, 'someone-else');

      const res = await app.inject({
        method: 'GET',
        url: '/api/foods/recent',
        headers: { cookie: other.cookie },
      });

      expect(res.json().foods).toEqual([]);
    });

    it("does not surface one user's manual foods in another's search", async () => {
      await post('/api/foods', { name: 'Secret recipe', kcal_per_100g: 100 });

      const other = await loginAs(app, db, 'someone-else');

      const res = await app.inject({
        method: 'GET',
        url: '/api/foods/search?q=Secret',
        headers: { cookie: other.cookie },
      });

      expect(res.json().saved).toEqual([]);
    });
  });
});
