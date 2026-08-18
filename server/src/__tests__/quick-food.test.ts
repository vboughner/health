import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testDb, testApp, loginAs, fakeUsda, USDA_BANANA, type Payload, type Res } from './helpers';
import type { Db } from '../db';

const DAY = '2026-01-15';
/** A local wall-clock time on DAY, in Pacific (the default user timezone). */
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00-08:00`);

describe('logging calories only', () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = testDb();
    app = testApp(db, fakeUsda([USDA_BANANA]));
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

  const quick = (name: string, kcal: number, hhmm = '13:04') =>
    post('/api/log/quick', { name, kcal, eaten_at: at(hhmm) });

  const summary = async () => (await get(`/api/summary/${DAY}`)).json();

  const logBanana = (grams: number, hhmm: string) =>
    post('/api/log/food', {
      food: { source: 'usda', ...USDA_BANANA },
      quantity: grams,
      unit: 'g',
      eaten_at: at(hhmm),
    });

  it('records the name and the calories', async () => {
    const res = await quick('Chipotle bowl', 720);

    expect(res.statusCode).toBe(201);
    expect(res.json().entry).toMatchObject({
      food_name: 'Chipotle bowl',
      kcal: 720,
      food_id: null,
      macros_unknown: true,
      weight_unknown: true,
    });
  });

  it('saves no food, so it never turns up in search or the frequent list', async () => {
    expect((await quick('Chipotle bowl', 720)).statusCode).toBe(201);

    expect(db.prepare('SELECT COUNT(*) c FROM foods').get()).toEqual({ c: 0 });
    expect((await get('/api/foods/search?q=Chipotle')).json().saved).toEqual([]);
    expect((await get('/api/foods/frequent')).json().foods).toEqual([]);
  });

  it('trims the name', async () => {
    const res = await quick('  Birthday cake  ', 400);

    expect(res.json().entry.food_name).toBe('Birthday cake');
  });

  it('counts toward the day, and files itself on the day it was eaten', async () => {
    await quick('Chipotle bowl', 720, '13:04');

    const day = await summary();
    expect(day.food.totals.kcal).toBe(720);
    expect(day.food.entries).toHaveLength(1);
    expect(day.food.entries[0].local_day).toBe(DAY);
  });

  it('leaves the macro split to the foods that have macros', async () => {
    await logBanana(100, '09:12');
    const before = (await summary()).food.macros;

    expect((await quick('Chipotle bowl', 720, '13:04')).statusCode).toBe(201);

    expect((await summary()).food.totals.kcal).toBe(809);
    expect((await summary()).food.macros).toEqual(before);
  });

  it('reports how many of the day calories have no macros on record', async () => {
    await logBanana(100, '09:12');
    await quick('Chipotle bowl', 720, '13:04');
    await quick('Oat latte', 190, '15:30');

    expect((await summary()).food.macro_unknown_kcal).toBe(910);
  });

  it('reports zero uncounted calories on a day of ordinary foods', async () => {
    await logBanana(100, '09:12');

    expect((await summary()).food.macro_unknown_kcal).toBe(0);
  });

  it('counts as a bite, so it moves the eating window', async () => {
    await logBanana(100, '09:12');
    await quick('Late slice of cake', 300, '21:40');

    const day = await summary();
    expect(day.window.first).toBe('09:12');
    expect(day.window.last).toBe('21:40');
    expect(day.window.compliant).toBe(false);
  });

  it('defaults to now when no time is given', async () => {
    const before = Date.now();

    const res = await post('/api/log/quick', { name: 'Handful of nuts', kcal: 90 });

    expect(res.json().entry.eaten_at).toBeGreaterThanOrEqual(before);
  });

  it('can be deleted like any other entry', async () => {
    const id = (await quick('Chipotle bowl', 720)).json().entry.id;

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/log/food/${id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect((await summary()).food.entries).toEqual([]);
  });

  it('rejects an empty name', async () => {
    expect((await quick('   ', 720)).statusCode).toBe(400);
    expect((await post('/api/log/quick', { kcal: 720 })).statusCode).toBe(400);
  });

  it('rejects calories that are not a positive number', async () => {
    expect((await quick('Chipotle bowl', 0)).statusCode).toBe(400);
    expect((await quick('Chipotle bowl', -5)).statusCode).toBe(400);
    expect((await post('/api/log/quick', { name: 'x', kcal: 'lots' })).statusCode).toBe(400);
  });

  it('needs a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/log/quick',
      payload: { name: 'Chipotle bowl', kcal: 720 },
    });

    expect(res.statusCode).toBe(401);
  });
});
