import { describe, it, expect } from 'vitest';
import { testDb, testApp, loginAs } from './helpers';
import type { Db } from '../db';
import { listGoalPeriods, putGoalPeriod } from '../store';
import { localDay, addDays } from '../domain/day';
import { DEFAULT_GOALS } from '../domain/goals';

const GOALS = {
  kcal_budget: 2200,
  burn_target: 900,
  window_start: '10:00',
  window_end: '20:00',
};

function today() {
  return localDay(Date.now(), 'America/Los_Angeles');
}

/**
 * Give the account a history: one set of goals in force since long before today.
 *
 * createUser seeds a period dated the day the account was made, which for a test
 * account is today — so a fresh account behaves as though it had already been edited
 * today, and neither scope has a past to reach. Replacing that seed with an old one is
 * what "an account that has been running a while" means, and it is the only state in
 * which from_today and correction differ at all.
 */
function withHistory(db: Db, userId: number): void {
  db.prepare('DELETE FROM goal_periods WHERE user_id = ?').run(userId);
  putGoalPeriod(db, userId, { effective_from: '2020-01-01', ...DEFAULT_GOALS });
}

describe('PUT /settings/goals', () => {
  it('rejects an anonymous caller', async () => {
    const db = testDb();
    const app = testApp(db);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      payload: { ...GOALS, scope: 'from_today' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an unknown scope', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'whenever' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('scope');
    await app.close();
  });

  it('rejects goals that fail validation, without writing anything', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, window_end: '09:00', scope: 'from_today' },
    });

    expect(res.statusCode).toBe(400);
    expect(listGoalPeriods(db, userId)).toHaveLength(1);
    await app.close();
  });

  it('from_today adds a period and leaves the old one alone', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'from_today' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().goals).toEqual(GOALS);

    const periods = listGoalPeriods(db, userId);
    expect(periods).toHaveLength(2);
    expect(periods[0].kcal_budget).toBe(2400);
    expect(periods[1]).toMatchObject({ effective_from: today(), kcal_budget: 2200 });

    await app.close();
  });

  it('correction rewrites the period covering today, adding nothing', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'correction' },
    });

    expect(res.statusCode).toBe(200);

    const periods = listGoalPeriods(db, userId);
    expect(periods).toHaveLength(1);
    expect(periods[0].kcal_budget).toBe(2200);

    await app.close();
  });

  it('a correction leaves an earlier deliberate change standing', async () => {
    // The reason correction targets the covering period rather than all of history:
    // fixing an October typo must not quietly undo a September schedule change.
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

    await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'from_today' },
    });

    await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, kcal_budget: 2100, scope: 'correction' },
    });

    const periods = listGoalPeriods(db, userId);
    expect(periods).toHaveLength(2);
    expect(periods[0].kcal_budget).toBe(2400); // the original, untouched
    expect(periods[1].kcal_budget).toBe(2100); // today's, corrected
    await app.close();
  });

  it('the two scopes converge once a period already starts today', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

    for (const scope of ['from_today', 'correction']) {
      await app.inject({
        method: 'PUT',
        url: '/api/settings/goals',
        headers: { cookie },
        payload: { ...GOALS, scope },
      });
    }

    // Two writes, still two periods: the seeded one and today's.
    expect(listGoalPeriods(db, userId)).toHaveLength(2);
    await app.close();
  });

  it('does not touch another account', async () => {
    const db = testDb();
    const app = testApp(db);
    const van = await loginAs(app, db, 'van');
    withHistory(db, van.userId);
    const other = await loginAs(app, db, 'sam');

    await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie: van.cookie },
      payload: { ...GOALS, scope: 'correction' },
    });

    expect(listGoalPeriods(db, other.userId)[0].kcal_budget).toBe(2400);
    await app.close();
  });

  it('shows up on /auth/me straight away', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'from_today' },
    });

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().goals).toEqual(GOALS);
    await app.close();
  });

  it('leaves yesterday judged by the old numbers after from_today', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

    await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'from_today' },
    });

    const yesterday = await app.inject({
      method: 'GET',
      url: `/api/summary/${addDays(today(), -1)}`,
      headers: { cookie },
    });

    expect(yesterday.json().food.budget).toBe(2400);
    expect(yesterday.json().window.target_end).toBe('19:00');
    await app.close();
  });

  it('changes yesterday after a correction', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

    await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'correction' },
    });

    const yesterday = await app.inject({
      method: 'GET',
      url: `/api/summary/${addDays(today(), -1)}`,
      headers: { cookie },
    });

    expect(yesterday.json().food.budget).toBe(2200);
    await app.close();
  });

  it('on a brand-new account, from_today leaves no history to preserve', async () => {
    // The obvious way to pin this is to assert listGoalPeriods has length 1: the
    // account's only period (createUser's seed) and this write should land on the
    // same day and collapse into one row via the upsert. But the seed is dated in
    // UTC (new Date(now).toISOString().slice(0, 10)) and this write is dated in the
    // user's local day (localDay(Date.now(), user.timezone)) — those two strings
    // only agree for part of the day. For the roughly eight hours from 00:00 UTC to
    // ~08:00 UTC (LA's previous afternoon and evening) they diverge: the upsert
    // inserts a second row instead of overwriting the first, and a row-count
    // assertion here would pass or fail depending on the hour the suite happened to
    // run. That skew, not the collision itself, is the actual trap.
    //
    // The property that holds regardless of the hour is behavioural: a fresh account
    // has no history to divide, so a day from long before the account existed
    // reports the *new* numbers too. That is true whether the seed collided with the
    // write (one row, and the query falls back to it) or landed a day off it (two
    // rows, and the query falls back to the earlier of the two — which is the row
    // this write just made, since nothing predates it). Contrast this with
    // `from_today adds a period and leaves the old one alone`, where withHistory()
    // gives the account a real past and the same kind of query returns the *old*
    // numbers instead — the difference is entirely whether there was a history to
    // preserve, not which row the seed happened to land on.
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'from_today' },
    });
    expect(put.statusCode).toBe(200);

    const longAgo = await app.inject({
      method: 'GET',
      url: '/api/summary/2019-06-01',
      headers: { cookie },
    });

    expect(longAgo.json().food.budget).toBe(GOALS.kcal_budget);
    await app.close();
  });
});

const ALL_ON = { food: true, exercise: true, sleep: true, weight: true, goals: true };

describe('PUT /settings/features', () => {
  it('rejects an anonymous caller', async () => {
    const db = testDb();
    const app = testApp(db);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/features',
      payload: ALL_ON,
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('starts with everything on', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user.features).toEqual(ALL_ON);
    await app.close();
  });

  it('remembers a feature going off, and coming back', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    await app.inject({
      method: 'PUT',
      url: '/api/settings/features',
      headers: { cookie },
      payload: { ...ALL_ON, exercise: false },
    });

    let me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user.features.exercise).toBe(false);

    await app.inject({
      method: 'PUT',
      url: '/api/settings/features',
      headers: { cookie },
      payload: ALL_ON,
    });

    me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user.features.exercise).toBe(true);
    await app.close();
  });

  it('rejects a body missing a feature rather than guessing at it', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/features',
      headers: { cookie },
      payload: { food: true, exercise: true, sleep: true, weight: true },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('does not let an unrecognised key through', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/features',
      headers: { cookie },
      payload: { ...ALL_ON, mood: false },
    });

    expect(res.json().features).toEqual(ALL_ON);
    await app.close();
  });

  it('does not touch another account', async () => {
    const db = testDb();
    const app = testApp(db);
    const van = await loginAs(app, db, 'van');
    const sam = await loginAs(app, db, 'sam');

    await app.inject({
      method: 'PUT',
      url: '/api/settings/features',
      headers: { cookie: van.cookie },
      payload: { ...ALL_ON, sleep: false },
    });

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sam.cookie },
    });
    expect(me.json().user.features.sleep).toBe(true);
    await app.close();
  });
});

describe('the plan', () => {
  it('is empty for a new account', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/plan',
      headers: { cookie },
    });

    expect(res.json()).toEqual({ plan: '' });
    await app.close();
  });

  it('round-trips what was written', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const plan = '## Calories\n\n- About 2400 a day.';
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings/plan',
      headers: { cookie },
      payload: { plan },
    });

    expect(put.json()).toEqual({ plan });

    const get = await app.inject({
      method: 'GET',
      url: '/api/settings/plan',
      headers: { cookie },
    });
    expect(get.json().plan).toBe(plan);
    await app.close();
  });

  it('rejects a plan that is not a string', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/plan',
      headers: { cookie },
      payload: { plan: 42 },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a plan far longer than anyone reads at arms length', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/plan',
      headers: { cookie },
      payload: { plan: 'x'.repeat(50_001) },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('is not readable from another account', async () => {
    const db = testDb();
    const app = testApp(db);
    const van = await loginAs(app, db, 'van');
    const sam = await loginAs(app, db, 'sam');

    await app.inject({
      method: 'PUT',
      url: '/api/settings/plan',
      headers: { cookie: van.cookie },
      payload: { plan: '## Mine' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/plan',
      headers: { cookie: sam.cookie },
    });
    expect(res.json().plan).toBe('');
    await app.close();
  });
});
