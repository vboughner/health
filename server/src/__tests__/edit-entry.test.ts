import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  testDb,
  testApp,
  loginAs,
  fakeUsda,
  USDA_BANANA,
  USDA_COOKIE,
  type Payload,
  type Res,
} from './helpers';
import type { Db } from '../db';

const DAY = '2026-01-15';
/** A local wall-clock time on DAY, in Pacific (the default user timezone). */
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00-08:00`);

describe('editing a logged entry', () => {
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

  const post = (url: string, payload?: Payload): Res =>
    app.inject({ method: 'POST', url, payload, headers: { cookie } });
  const get = (url: string): Res => app.inject({ method: 'GET', url, headers: { cookie } });
  const patch = (url: string, payload?: Payload): Res =>
    app.inject({ method: 'PATCH', url, payload, headers: { cookie } });

  /** Two servings of cookie: 64 g, 320 cal, 3.2 P / 16 F / 41.6 C. */
  async function logCookie(hhmm = '13:00') {
    const res = await post('/api/log/food', {
      food: { source: 'usda', ...USDA_COOKIE },
      quantity: 2,
      unit: 'serving',
      eaten_at: at(hhmm),
    });
    return res.json().entry;
  }

  async function logQuick(hhmm = '19:30') {
    const res = await post('/api/log/quick', {
      name: 'Chipotle bowl',
      kcal: 720,
      eaten_at: at(hhmm),
    });
    return res.json().entry;
  }

  describe('a food entry', () => {
    it('rescales grams, calories and macros when the amount changes', async () => {
      const entry = await logCookie();

      const res = await patch(`/api/log/food/${entry.id}`, { quantity: 3 });

      expect(res.statusCode).toBe(200);
      expect(res.json().entry).toMatchObject({
        quantity: 3,
        unit: 'serving',
        grams: 96,
        kcal: 480,
        protein_g: 4.8,
        fat_g: 24,
        carb_g: 62.4,
      });
    });

    it('back-solves the amount when the calories change', async () => {
      const entry = await logCookie();

      // 400 of 320 is a quarter more of the same thing.
      const res = await patch(`/api/log/food/${entry.id}`, { kcal: 400 });

      expect(res.statusCode).toBe(200);
      expect(res.json().entry).toMatchObject({
        quantity: 2.5,
        unit: 'serving',
        grams: 80,
        kcal: 400,
        protein_g: 4,
        fat_g: 20,
        carb_g: 52,
      });
    });

    it('leaves the figures alone when only the time changes', async () => {
      const entry = await logCookie('13:00');

      const res = await patch(`/api/log/food/${entry.id}`, { eaten_at: at('09:15') });

      expect(res.statusCode).toBe(200);
      expect(res.json().entry).toMatchObject({
        eaten_at: at('09:15'),
        local_day: DAY,
        quantity: 2,
        grams: 64,
        kcal: 320,
        protein_g: 3.2,
      });
    });

    it('scales what the entry recorded, not what the food says now', async () => {
      const entry = await logCookie();

      // The food is re-cached at half the calories it had when this was logged.
      await post('/api/foods', { ...USDA_COOKIE, kcal_per_100g: 250 });

      const res = await patch(`/api/log/food/${entry.id}`, { quantity: 4 });

      // Twice the amount of what was eaten, not of what the food costs today.
      expect(res.json().entry.kcal).toBe(640);
    });

    it('keeps the entry out of the eating window until its new time', async () => {
      const entry = await logCookie('13:00');
      await patch(`/api/log/food/${entry.id}`, { eaten_at: at('20:30') });

      const win = (await get(`/api/summary/${DAY}`)).json().window;

      expect(win.last).toBe('20:30');
      expect(win.endedOnTime).toBe(false);
    });

    it('keeps a serving-measured food showing no weight', async () => {
      const food = (
        await post('/api/foods', {
          name: 'Soup from the deli',
          kcal_per_100g: 320,
          protein_g: 10,
          fat_g: 8,
          carb_g: 40,
          serving_grams: 100,
          serving_desc: 'bowl',
          weight_unknown: true,
        })
      ).json().food;
      const entry = (
        await post('/api/log/food', { food_id: food.id, quantity: 1, unit: 'serving' })
      ).json().entry;

      const res = await patch(`/api/log/food/${entry.id}`, { quantity: 2 });

      expect(res.json().entry).toMatchObject({ quantity: 2, kcal: 640, weight_unknown: true });
    });

    it('refuses an amount and a calorie figure in the same edit', async () => {
      const entry = await logCookie();

      const res = await patch(`/api/log/food/${entry.id}`, { quantity: 3, kcal: 400 });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/amount or the calories/i);
    });

    it('refuses to back-solve an entry that cost no calories', async () => {
      const food = (
        await post('/api/foods', {
          name: 'Black coffee',
          kcal_per_100g: 0,
          protein_g: 0,
          fat_g: 0,
          carb_g: 0,
        })
      ).json().food;
      const entry = (
        await post('/api/log/food', { food_id: food.id, quantity: 250, unit: 'g' })
      ).json().entry;

      const res = await patch(`/api/log/food/${entry.id}`, { kcal: 400 });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/no calories/i);
    });

    it('refuses a name, which belongs to the food behind it', async () => {
      const entry = await logCookie();

      const res = await patch(`/api/log/food/${entry.id}`, { name: 'Something else' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/name/i);
    });

    it('refuses an amount that is not a positive number', async () => {
      const entry = await logCookie();

      expect((await patch(`/api/log/food/${entry.id}`, { quantity: 0 })).statusCode).toBe(400);
      expect((await patch(`/api/log/food/${entry.id}`, { quantity: -2 })).statusCode).toBe(400);
    });
  });

  describe('a quick entry', () => {
    it('edits its name, its calories and its time', async () => {
      const entry = await logQuick('19:30');

      const res = await patch(`/api/log/food/${entry.id}`, {
        name: 'Chipotle burrito',
        kcal: 900,
        eaten_at: at('18:45'),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().entry).toMatchObject({
        food_name: 'Chipotle burrito',
        kcal: 900,
        eaten_at: at('18:45'),
      });
    });

    it('still says its macros were never recorded', async () => {
      const entry = await logQuick();

      const res = await patch(`/api/log/food/${entry.id}`, { kcal: 900 });

      expect(res.json().entry).toMatchObject({
        macros_unknown: true,
        weight_unknown: true,
        quantity: 1,
        grams: 0,
        protein_g: 0,
        fat_g: 0,
        carb_g: 0,
      });
    });

    it('keeps its calories out of the macro split after an edit', async () => {
      const entry = await logQuick();
      await patch(`/api/log/food/${entry.id}`, { kcal: 900 });

      const food = (await get(`/api/summary/${DAY}`)).json().food;

      expect(food.macro_unknown_kcal).toBe(900);
    });

    it('refuses an amount, which it does not have', async () => {
      const entry = await logQuick();

      const res = await patch(`/api/log/food/${entry.id}`, { quantity: 2 });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/no amount/i);
    });

    it('refuses a blank name', async () => {
      const entry = await logQuick();

      const res = await patch(`/api/log/food/${entry.id}`, { name: '   ' });

      expect(res.statusCode).toBe(400);
    });
  });

  it('refuses an edit that changes nothing', async () => {
    const entry = await logCookie();

    const res = await patch(`/api/log/food/${entry.id}`, {});

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/nothing to change/i);
  });

  it('404s on an entry belonging to someone else, and leaves it alone', async () => {
    const entry = await logCookie();
    const other = await loginAs(app, db, 'someone-else');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/log/food/${entry.id}`,
      payload: { quantity: 99 },
      headers: { cookie: other.cookie },
    });

    expect(res.statusCode).toBe(404);
    expect((await get(`/api/log/food?date=${DAY}`)).json().entries[0]).toMatchObject({
      quantity: 2,
      kcal: 320,
    });
  });

  it('404s on an id that does not exist', async () => {
    expect((await patch('/api/log/food/9999', { quantity: 2 })).statusCode).toBe(404);
  });

  it('400s on an id that is not a number', async () => {
    expect((await patch('/api/log/food/abc', { quantity: 2 })).statusCode).toBe(400);
  });

  it('refiles the entry when the new time lands on another day', async () => {
    const entry = await logCookie('13:00');

    const res = await patch(`/api/log/food/${entry.id}`, { eaten_at: at('13:00') - 86400000 });

    expect(res.json().entry.local_day).toBe('2026-01-14');
    expect((await get(`/api/log/food?date=${DAY}`)).json().entries).toHaveLength(0);
  });
});
