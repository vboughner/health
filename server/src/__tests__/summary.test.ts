import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testDb, testApp, loginAs, fakeUsda, USDA_BANANA } from './helpers';
import type { Db } from '../db';

const DAY = '2026-01-15';
/** A local wall-clock time on DAY, in Pacific (the default user timezone). */
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00-08:00`);

describe('daily entry and summary', () => {
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

  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, payload, headers: { cookie } });
  const put = (url: string, payload: unknown) =>
    app.inject({ method: 'PUT', url, payload, headers: { cookie } });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const summary = async () => (await get(`/api/summary/${DAY}`)).json();

  const logFood = (kcalPer100g: number, grams: number, hhmm: string) =>
    post('/api/log/food', {
      food: {
        source: 'usda',
        ...USDA_BANANA,
        source_id: `f${kcalPer100g}`,
        kcal_per_100g: kcalPer100g,
      },
      quantity: grams,
      unit: 'g',
      eaten_at: at(hhmm),
    });

  describe('weight, sleep, and check-in', () => {
    it('starts blank for an untouched day', async () => {
      const res = await get(`/api/day/${DAY}`);

      expect(res.json().day).toEqual({
        local_day: DAY,
        weight_lb: null,
        sleep_start: null,
        sleep_end: null,
        reviewed_morning: false,
        reviewed_night: false,
        no_meat: false,
        no_dairy: false,
        note: null,
      });
    });

    it('saves a weight', async () => {
      const res = await put(`/api/day/${DAY}`, { weight_lb: 194.5 });
      expect(res.json().day.weight_lb).toBe(194.5);
    });

    it('ticks a check-in box without disturbing anything else', async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 194.5, no_meat: true });
      await put(`/api/day/${DAY}`, { reviewed_morning: true });

      const day = (await get(`/api/day/${DAY}`)).json().day;

      expect(day).toMatchObject({
        weight_lb: 194.5,
        no_meat: true,
        reviewed_morning: true,
        reviewed_night: false,
      });
    });

    it('can untick a box', async () => {
      await put(`/api/day/${DAY}`, { no_meat: true });
      await put(`/api/day/${DAY}`, { no_meat: false });

      expect((await get(`/api/day/${DAY}`)).json().day.no_meat).toBe(false);
    });

    it('computes hours slept across midnight', async () => {
      await put(`/api/day/${DAY}`, {
        sleep_start: Date.parse(`${DAY}T22:30:00-08:00`),
        sleep_end: Date.parse('2026-01-16T06:15:00-08:00'),
      });

      expect((await summary()).day.sleep_hours).toBe(7.8);
    });

    it('reports null hours when only one end is recorded', async () => {
      await put(`/api/day/${DAY}`, { sleep_start: at('22:30') });
      expect((await summary()).day.sleep_hours).toBeNull();
    });

    it('rejects a wake time before the sleep time', async () => {
      const res = await put(`/api/day/${DAY}`, {
        sleep_start: at('22:30'),
        sleep_end: at('06:00'),
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects an implausible weight', async () => {
      expect((await put(`/api/day/${DAY}`, { weight_lb: 0 })).statusCode).toBe(400);
      expect((await put(`/api/day/${DAY}`, { weight_lb: -5 })).statusCode).toBe(400);
      expect((await put(`/api/day/${DAY}`, { weight_lb: 5000 })).statusCode).toBe(400);
    });

    it('rejects a malformed date', async () => {
      expect((await get('/api/day/not-a-date')).statusCode).toBe(400);
      expect((await put('/api/day/2026-1-5', { weight_lb: 190 })).statusCode).toBe(400);
    });
  });

  describe('exercise', () => {
    beforeEach(async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 195 });
    });

    it('estimates calories from activity, minutes, and current weight', async () => {
      const res = await post('/api/log/exercise', {
        activity: 'running',
        minutes: 30,
        date: DAY,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().entry).toMatchObject({ kcal: 455, source: 'estimated' });
    });

    it('lets a watch reading override the estimate and marks it measured', async () => {
      const res = await post('/api/log/exercise', {
        activity: 'running',
        minutes: 30,
        kcal: 512,
        date: DAY,
      });

      expect(res.json().entry).toMatchObject({ kcal: 512, source: 'measured' });
    });

    it('uses the most recent weight on or before the day, not a later one', async () => {
      await put('/api/day/2026-01-20', { weight_lb: 170 });

      const res = await post('/api/log/exercise', {
        activity: 'running',
        minutes: 30,
        date: DAY,
      });

      // Still the 195 lb figure — the later weigh-in must not rewrite an earlier day.
      expect(res.json().entry.kcal).toBe(455);
    });

    it('asks for a weight when there is none and no watch number', async () => {
      const fresh = await loginAs(app, db, 'no-weight-yet');

      const res = await app.inject({
        method: 'POST',
        url: '/api/log/exercise',
        payload: { activity: 'running', minutes: 30, date: DAY },
        headers: { cookie: fresh.cookie },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/weight/i);
    });

    it('accepts a watch number with no weight on record', async () => {
      const fresh = await loginAs(app, db, 'watch-only');

      const res = await app.inject({
        method: 'POST',
        url: '/api/log/exercise',
        payload: { activity: 'running', minutes: 30, kcal: 500, date: DAY },
        headers: { cookie: fresh.cookie },
      });

      expect(res.statusCode).toBe(201);
    });

    it('rejects an unknown activity', async () => {
      const res = await post('/api/log/exercise', { activity: 'quidditch', minutes: 30 });
      expect(res.statusCode).toBe(400);
    });

    it('rejects zero or negative minutes', async () => {
      expect(
        (await post('/api/log/exercise', { activity: 'running', minutes: 0 })).statusCode,
      ).toBe(400);
      expect(
        (await post('/api/log/exercise', { activity: 'running', minutes: -5 })).statusCode,
      ).toBe(400);
    });

    it('deletes an entry', async () => {
      const created = await post('/api/log/exercise', {
        activity: 'climbing',
        minutes: 60,
        date: DAY,
      });

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/log/exercise/${created.json().entry.id}`,
        headers: { cookie },
      });

      expect(del.statusCode).toBe(204);
      expect((await summary()).exercise.entries).toEqual([]);
    });

    it('exposes the activity list with its MET values', async () => {
      const res = await get('/api/activities');

      expect(res.json().activities).toEqual(
        expect.arrayContaining([{ id: 'running', label: 'Running', met: 9.8 }]),
      );
    });
  });

  describe('summary', () => {
    it('is empty but well-formed for a day with nothing on it', async () => {
      const s = await summary();

      expect(s.food.totals).toEqual({ kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 });
      expect(s.food.remaining).toBe(2400);
      expect(s.exercise.total).toBe(0);
      expect(s.window.compliant).toBeNull();
      expect(s.net.tooLow).toBe(false);
    });

    it('rolls up food, exercise, window, sleep, and check-in in one call', async () => {
      await put(`/api/day/${DAY}`, {
        weight_lb: 195,
        no_meat: true,
        reviewed_morning: true,
        sleep_start: Date.parse(`2026-01-14T22:30:00-08:00`),
        sleep_end: Date.parse(`${DAY}T06:30:00-08:00`),
      });
      await logFood(89, 500, '09:30');
      await logFood(123, 500, '18:00');
      await post('/api/log/exercise', { activity: 'running', minutes: 30, date: DAY });

      const s = await summary();

      expect(s.food.totals.kcal).toBe(1060);
      expect(s.food.remaining).toBe(1340);
      expect(s.exercise.total).toBe(455);
      expect(s.exercise.target).toBe(960);
      expect(s.window).toMatchObject({ first: '09:30', last: '18:00', compliant: true });
      expect(s.day).toMatchObject({ weight_lb: 195, no_meat: true, sleep_hours: 8 });
      expect(s.net.net).toBe(605);
    });

    it('derives the eating window from the food log rather than asking', async () => {
      await logFood(89, 100, '07:45');
      await logFood(89, 100, '20:30');

      const s = await summary();

      expect(s.window).toMatchObject({
        first: '07:45',
        last: '20:30',
        startedOnTime: false,
        endedOnTime: false,
        compliant: false,
      });
    });

    it('reports the target window alongside the actual one', async () => {
      const s = await summary();
      expect(s.window).toMatchObject({ target_start: '09:00', target_end: '19:00' });
    });

    it('flags a day where exercise leaves net intake too low', async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 195 });
      await logFood(100, 1500, '12:00'); // 1500 cal
      await post('/api/log/exercise', { activity: 'running', minutes: 30, kcal: 900, date: DAY });

      const s = await summary();

      expect(s.net.net).toBe(600);
      expect(s.net.tooLow).toBe(true);
    });

    it('reports macro percentages of calories', async () => {
      await logFood(89, 500, '12:00');

      const s = await summary();
      const sum = s.food.macros.protein + s.food.macros.fat + s.food.macros.carb;

      expect(sum).toBeCloseTo(100, 0);
      expect(s.food.macros.carb).toBeGreaterThan(s.food.macros.protein);
    });

    it('goes negative on remaining once the budget is passed', async () => {
      await logFood(500, 600, '12:00'); // 3000 cal

      expect((await summary()).food.remaining).toBe(-600);
    });

    it("accepts 'today' as a date", async () => {
      const res = await get('/api/summary/today');
      expect(res.statusCode).toBe(200);
      expect(res.json().date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects a malformed date', async () => {
      expect((await get('/api/summary/yesterday')).statusCode).toBe(400);
    });

    it('separates measured burn from estimated', async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 195 });
      await post('/api/log/exercise', { activity: 'running', minutes: 30, date: DAY });
      await post('/api/log/exercise', {
        activity: 'climbing',
        minutes: 60,
        kcal: 700,
        date: DAY,
      });

      const s = await summary();

      expect(s.exercise.estimated).toBe(455);
      expect(s.exercise.measured).toBe(700);
      expect(s.exercise.total).toBe(1155);
    });
  });

  describe('access control', () => {
    it.each([
      ['GET', `/api/day/${DAY}`],
      ['PUT', `/api/day/${DAY}`],
      ['GET', `/api/summary/${DAY}`],
      ['GET', '/api/activities'],
      ['POST', '/api/log/exercise'],
      ['DELETE', '/api/log/exercise/1'],
    ])('%s %s requires a session', async (method, url) => {
      const res = await app.inject({ method: method as 'GET', url, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("does not leak one user's day into another's", async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 195, note: 'private' });

      const other = await loginAs(app, db, 'someone-else');

      const res = await app.inject({
        method: 'GET',
        url: `/api/day/${DAY}`,
        headers: { cookie: other.cookie },
      });

      expect(res.json().day.weight_lb).toBeNull();
      expect(res.json().day.note).toBeNull();
    });

    it("does not let one user delete another's exercise entry", async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 195 });
      const created = await post('/api/log/exercise', {
        activity: 'running',
        minutes: 30,
        date: DAY,
      });

      const other = await loginAs(app, db, 'someone-else');

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/log/exercise/${created.json().entry.id}`,
        headers: { cookie: other.cookie },
      });

      expect(del.statusCode).toBe(404);
      expect((await summary()).exercise.entries).toHaveLength(1);
    });

    it("does not use one user's weight to estimate another's burn", async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 195 });

      const other = await loginAs(app, db, 'someone-else');

      const res = await app.inject({
        method: 'POST',
        url: '/api/log/exercise',
        payload: { activity: 'running', minutes: 30, date: DAY },
        headers: { cookie: other.cookie },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
