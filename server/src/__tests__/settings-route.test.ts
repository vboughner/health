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
    withHistory(db, userId);

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
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

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

  it('on a brand-new account, both scopes write the one period there is', async () => {
    // createUser seeds a period dated the day the account was made. A test account's
    // account-creation day and its first PUT happen in the same instant, so that seed
    // is dated today — there is no earlier period for from_today to leave alone, and
    // none for correction to leave standing, because the account genuinely has no
    // history yet. Both scopes resolve to today's row and write it, which is the
    // right answer, not a bug: see withHistory() above, which is what turns "brand
    // new" into "has been running a while" for every other test in this file.
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, scope: 'from_today' },
    });

    expect(res.statusCode).toBe(200);

    const periods = listGoalPeriods(db, userId);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ effective_from: today(), kcal_budget: 2200 });

    await app.close();
  });
});
