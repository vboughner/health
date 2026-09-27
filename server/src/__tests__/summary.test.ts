import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testDb, testApp, loginAs, fakeUsda, USDA_BANANA, type Payload, type Res } from './helpers';
import type { Db } from '../db';
import { putGoalPeriod, type DailyEntryPatch } from '../store';

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

  const post = (url: string, payload?: Payload): Res =>
    app.inject({ method: 'POST', url, payload, headers: { cookie } });
  // Typed as the patch shape, so a column dropped from the schema cannot keep being
  // written here and silently no-op — upsertDailyEntry filters unknown keys.
  const put = (url: string, payload: DailyEntryPatch): Res =>
    app.inject({ method: 'PUT', url, payload, headers: { cookie } });
  const get = (url: string): Res => app.inject({ method: 'GET', url, headers: { cookie } });

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

  describe('weight, sleep, and goal review', () => {
    it('starts blank for an untouched day', async () => {
      const res = await get(`/api/day/${DAY}`);

      expect(res.json().day).toEqual({
        local_day: DAY,
        weight_lb: null,
        sleep_start: null,
        sleep_end: null,
        goals_reviewed: false,
      });
    });

    it('saves a weight', async () => {
      const res = await put(`/api/day/${DAY}`, { weight_lb: 194.5 });
      expect(res.json().day.weight_lb).toBe(194.5);
    });

    it('marks the goals reviewed without disturbing anything else', async () => {
      await put(`/api/day/${DAY}`, { weight_lb: 194.5 });
      await put(`/api/day/${DAY}`, { goals_reviewed: true });

      const day = (await get(`/api/day/${DAY}`)).json().day;

      expect(day).toMatchObject({
        weight_lb: 194.5,
        goals_reviewed: true,
      });
    });

    it("pairs last night's bedtime with this morning's wake time", async () => {
      // Each field sits on the day it happened: bed on the 14th, up on the 15th.
      await put('/api/day/2026-01-14', { sleep_start: Date.parse('2026-01-14T22:30:00-08:00') });
      await put(`/api/day/${DAY}`, { sleep_end: Date.parse(`${DAY}T06:15:00-08:00`) });

      expect((await summary()).day.sleep_hours).toBe(7.8);
    });

    it('reports no hours when the previous evening has no bedtime', async () => {
      await put(`/api/day/${DAY}`, { sleep_end: Date.parse(`${DAY}T06:15:00-08:00`) });

      expect((await summary()).day.sleep_hours).toBeNull();
    });

    it('reports null hours when only the bedtime is recorded', async () => {
      await put('/api/day/2026-01-14', { sleep_start: Date.parse('2026-01-14T22:30:00-08:00') });
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
      expect(res.json().entry).toMatchObject({ kcal: 455 });
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

    it('asks for a weight when there is none on file', async () => {
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
    });

    it('rolls up food, exercise, window, and sleep in one call', async () => {
      await put('/api/day/2026-01-14', {
        sleep_start: Date.parse('2026-01-14T22:30:00-08:00'),
      });
      await put(`/api/day/${DAY}`, {
        weight_lb: 195,
        goals_reviewed: true,
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
      expect(s.day).toMatchObject({ weight_lb: 195, sleep_hours: 8 });
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
      await put(`/api/day/${DAY}`, { weight_lb: 195 });

      const other = await loginAs(app, db, 'someone-else');

      const res = await app.inject({
        method: 'GET',
        url: `/api/day/${DAY}`,
        headers: { cookie: other.cookie },
      });

      expect(res.json().day.weight_lb).toBeNull();
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

describe('dropped fields', () => {
  it('does not report a day with fields nothing writes', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'GET',
      url: `/api/summary/${DAY}`,
      headers: { cookie },
    });
    const body = res.json();

    for (const gone of ['no_meat', 'no_dairy', 'note']) {
      expect(body.day).not.toHaveProperty(gone);
    }
    for (const gone of ['estimated', 'measured', 'measuredShare']) {
      expect(body.exercise).not.toHaveProperty(gone);
    }

    await app.close();
  });

  it('ignores a patch naming a field that no longer exists', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/day/${DAY}`,
      headers: { cookie },
      payload: { weight_lb: 194.5, no_meat: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().day.weight_lb).toBe(194.5);
    expect(res.json().day).not.toHaveProperty('no_meat');

    await app.close();
  });
});

describe('effective-dated goals', () => {
  it('judges a day by the period covering it, not by the current numbers', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');

    // Two periods: 9-7 up to the end of July, 10-8 from August.
    putGoalPeriod(db, userId, {
      effective_from: '2026-01-01',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });
    putGoalPeriod(db, userId, {
      effective_from: '2026-08-01',
      kcal_budget: 2200,
      burn_target: 900,
      window_start: '10:00',
      window_end: '20:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });

    const july = await app.inject({
      method: 'GET',
      url: '/api/summary/2026-07-15',
      headers: { cookie },
    });
    const august = await app.inject({
      method: 'GET',
      url: '/api/summary/2026-08-15',
      headers: { cookie },
    });

    expect(july.json().window).toMatchObject({ target_start: '09:00', target_end: '19:00' });
    expect(july.json().food.budget).toBe(2400);
    expect(august.json().window).toMatchObject({ target_start: '10:00', target_end: '20:00' });
    expect(august.json().food.budget).toBe(2200);

    await app.close();
  });

  it('uses the earliest period for a day behind all of them', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');

    putGoalPeriod(db, userId, {
      effective_from: '2026-08-01',
      kcal_budget: 2200,
      burn_target: 900,
      window_start: '10:00',
      window_end: '20:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/summary/2026-01-05',
      headers: { cookie },
    });

    expect(res.json().food.budget).toBe(2200);

    await app.close();
  });
});

describe('food.protein', () => {
  it('reports grams against the range in force that day', async () => {
    const db = testDb();
    const app = testApp(db, fakeUsda([USDA_BANANA]));
    const { userId, cookie } = await loginAs(app, db, 'van');

    putGoalPeriod(db, userId, {
      effective_from: '2026-01-01',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });
    putGoalPeriod(db, userId, {
      effective_from: '2026-09-20',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: 90,
      protein_max_g: 130,
      weights_per_week: 2,
    });

    const before = await app.inject({
      method: 'GET',
      url: '/api/summary/2026-09-01',
      headers: { cookie },
    });
    const after = await app.inject({
      method: 'GET',
      url: '/api/summary/2026-09-25',
      headers: { cookie },
    });

    expect(before.json().food.protein).toEqual({ grams: 0, min: null, max: null, floor: false });
    expect(after.json().food.protein).toEqual({ grams: 0, min: 90, max: 130, floor: false });
    await app.close();
  });

  it('is a floor when a calories-only entry shares the day with a real food', async () => {
    const db = testDb();
    const app = testApp(db, fakeUsda([USDA_BANANA]));
    const { cookie } = await loginAs(app, db, 'van');
    const day = '2026-09-25';
    const at = (hhmm: string) => Date.parse(`${day}T${hhmm}:00-08:00`);
    const grams = 150;

    await app.inject({
      method: 'POST',
      url: '/api/log/food',
      payload: {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: grams,
        unit: 'g',
        eaten_at: at('09:00'),
      },
      headers: { cookie },
    });
    await app.inject({
      method: 'POST',
      url: '/api/log/quick',
      payload: { name: 'Chipotle bowl', kcal: 720, eaten_at: at('13:00') },
      headers: { cookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/summary/${day}`,
      headers: { cookie },
    });

    expect(res.json().food.protein).toMatchObject({
      grams: Math.round((USDA_BANANA.protein_g * grams) / 100),
      floor: true,
    });
    await app.close();
  });

  it('is not a floor when every entry that day has macros on record', async () => {
    const db = testDb();
    const app = testApp(db, fakeUsda([USDA_BANANA]));
    const { cookie } = await loginAs(app, db, 'van');
    const day = '2026-09-25';
    const at = (hhmm: string) => Date.parse(`${day}T${hhmm}:00-08:00`);
    const grams = 150;

    await app.inject({
      method: 'POST',
      url: '/api/log/food',
      payload: {
        food: { source: 'usda', ...USDA_BANANA },
        quantity: grams,
        unit: 'g',
        eaten_at: at('09:00'),
      },
      headers: { cookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/summary/${day}`,
      headers: { cookie },
    });

    expect(res.json().food.protein).toMatchObject({
      grams: Math.round((USDA_BANANA.protein_g * grams) / 100),
      floor: false,
    });
    await app.close();
  });
});
