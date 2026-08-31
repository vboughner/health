import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testDb, testApp, loginAs, type Payload, type Res } from './helpers';
import type { Db } from '../db';
import { estimateKcal } from '../domain/exercise';

const DAY = '2026-01-15';

describe('editing a logged exercise entry', () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = testDb();
    app = testApp(db);
    await app.ready();
    ({ cookie } = await loginAs(app, db, 'van'));
    // Calories are estimated from body weight, so a workout cannot be logged
    // without one on file.
    await put(`/api/day/${DAY}`, { weight_lb: 180 });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  function put(url: string, payload?: Payload): Res {
    return app.inject({ method: 'PUT', url, payload, headers: { cookie } });
  }
  const post = (url: string, payload?: Payload): Res =>
    app.inject({ method: 'POST', url, payload, headers: { cookie } });
  const patch = (url: string, payload?: Payload): Res =>
    app.inject({ method: 'PATCH', url, payload, headers: { cookie } });
  const get = (url: string): Res => app.inject({ method: 'GET', url, headers: { cookie } });

  async function logRun(minutes = 30) {
    const res = await post('/api/log/exercise', { activity: 'running', minutes, date: DAY });
    return res.json().entry;
  }

  it('rescales the calories when the minutes change', async () => {
    const entry = await logRun(30);

    const res = await patch(`/api/log/exercise/${entry.id}`, { minutes: 45 });

    expect(res.statusCode).toBe(200);
    expect(res.json().entry).toMatchObject({
      activity: 'running',
      minutes: 45,
      kcal: Math.round(entry.kcal * 1.5),
    });
  });

  it('rescales the calories when the activity changes', async () => {
    const entry = await logRun(30);

    const res = await patch(`/api/log/exercise/${entry.id}`, { activity: 'walking' });

    expect(res.statusCode).toBe(200);
    // Walking is 3.5 MET against running's 9.8.
    expect(res.json().entry).toMatchObject({
      activity: 'walking',
      minutes: 30,
      kcal: Math.round((entry.kcal * 3.5) / 9.8),
    });
  });

  it('prices the edit at the weight it was logged at, not the current one', async () => {
    const entry = await logRun(30);
    expect(entry.kcal).toBe(estimateKcal('running', 30, 180));

    // Two months of eating later.
    await put(`/api/day/${DAY}`, { weight_lb: 220 });

    const res = await patch(`/api/log/exercise/${entry.id}`, { minutes: 60 });
    const edited = res.json().entry;

    expect(edited.kcal).toBe(entry.kcal * 2);
    // Re-estimating would have produced a much bigger figure.
    expect(edited.kcal).toBeLessThan(estimateKcal('running', 60, 220) - 100);
  });

  it('persists the change, so the day rolls it up rescaled', async () => {
    const entry = await logRun(30);

    await patch(`/api/log/exercise/${entry.id}`, { minutes: 60 });

    const summary = await get(`/api/summary/${DAY}`);
    expect(summary.json().exercise.total).toBe(entry.kcal * 2);
  });

  it('leaves the day and the logged time alone', async () => {
    const entry = await logRun(30);

    const res = await patch(`/api/log/exercise/${entry.id}`, { minutes: 45 });

    expect(res.json().entry).toMatchObject({
      local_day: entry.local_day,
      logged_at: entry.logged_at,
    });
  });

  it('rejects an empty patch', async () => {
    const entry = await logRun();
    const res = await patch(`/api/log/exercise/${entry.id}`, {});

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/nothing to change/i);
  });

  it('rejects an activity that is not in the table', async () => {
    const entry = await logRun();
    const res = await patch(`/api/log/exercise/${entry.id}`, { activity: 'kayaking' });

    expect(res.statusCode).toBe(400);
  });

  it('rejects minutes that are not a positive number', async () => {
    const entry = await logRun();

    expect((await patch(`/api/log/exercise/${entry.id}`, { minutes: 0 })).statusCode).toBe(400);
    expect((await patch(`/api/log/exercise/${entry.id}`, { minutes: -5 })).statusCode).toBe(400);
  });

  // Asserts the body, not just the status: with no route registered at all Fastify
  // 404s on its own, so a bare status check here passes before anything is built.
  it('404s on an entry that does not exist', async () => {
    const res = await patch('/api/log/exercise/9999', { minutes: 45 });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Entry not found' });
  });

  it("404s on another user's entry rather than editing it", async () => {
    const entry = await logRun();
    const { cookie: other } = await loginAs(app, db, 'someone-else');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/log/exercise/${entry.id}`,
      payload: { minutes: 45 },
      headers: { cookie: other },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Entry not found' });
    // And the entry is untouched.
    expect((await get(`/api/summary/${DAY}`)).json().exercise.total).toBe(entry.kcal);
  });

  it('requires a session', async () => {
    const entry = await logRun();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/log/exercise/${entry.id}`,
      payload: { minutes: 45 },
    });

    expect(res.statusCode).toBe(401);
  });
});
