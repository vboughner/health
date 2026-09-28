import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testDb, testApp, loginAs, fakeUsda, USDA_BANANA, type Payload, type Res } from './helpers';
import type { Db } from '../db';
import { putGoalPeriod, type DailyEntryPatch } from '../store';
import { localDay } from '../domain/day';
import { mondayOf } from '../domain/trend';

const TZ = 'America/Los_Angeles';

describe('GET /api/trends', () => {
  let db: Db;
  let app: FastifyInstance;
  let userId: number;
  let cookie: string;
  let today: string;

  beforeEach(async () => {
    db = testDb();
    app = testApp(db, fakeUsda([USDA_BANANA]));
    await app.ready();
    ({ userId, cookie } = await loginAs(app, db, 'van'));
    today = localDay(Date.now(), TZ);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const get = (url: string): Res => app.inject({ method: 'GET', url, headers: { cookie } });
  const put = (url: string, payload: DailyEntryPatch): Res =>
    app.inject({ method: 'PUT', url, payload, headers: { cookie } });
  const post = (url: string, payload?: Payload): Res =>
    app.inject({ method: 'POST', url, payload, headers: { cookie } });

  /** A day N days before today, as YYYY-MM-DD. */
  const daysAgo = (n: number) => localDay(Date.now() - n * 86_400_000, TZ);

  /** Log food on a past day at a given local hour. */
  const logOn = (day: string, hour: number, kcalPer100g: number, grams: number) =>
    post('/api/log/food', {
      food: {
        source: 'usda',
        ...USDA_BANANA,
        source_id: `f${kcalPer100g}`,
        kcal_per_100g: kcalPer100g,
      },
      quantity: grams,
      unit: 'g',
      eaten_at: Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00-08:00`),
    });

  it('returns one row per day in the range, oldest first', async () => {
    const res = await get('/api/trends?days=7');

    expect(res.statusCode).toBe(200);
    expect(res.json().days).toHaveLength(7);
    expect(res.json().days[6].day).toBe(today);
    expect(res.json().to).toBe(today);
  });

  it('leaves unlogged days as nulls rather than filling them in', async () => {
    const res = await get('/api/trends?days=7');

    expect(res.json().days[0]).toMatchObject({
      kcal: null,
      burned: null,
      weight_lb: null,
      sleep_hours: null,
      window_compliant: null,
      goals_reviewed: null,
    });
  });

  it('reports an unreviewed day with activity as false, not unknown', async () => {
    // The day was lived and logged; the goals genuinely went unreviewed. Only a day
    // with no record at all is unknown, so a real miss can't hide as a blank cell.
    await logOn(daysAgo(1), 12, 100, 100);

    const rows = (await get('/api/trends?days=7')).json().days;
    const row = rows.find((d: { day: string }) => d.day === daysAgo(1));

    expect(row.goals_reviewed).toBe(false);
  });

  it.each([
    ['a weigh-in', { weight_lb: 195 } as DailyEntryPatch],
    ['a wake time', { sleep_end: Date.parse(`2020-01-01T06:00:00-08:00`) } as DailyEntryPatch],
  ])('counts a day with only %s as unreviewed rather than unknown', async (_label, patch) => {
    await put(`/api/day/${daysAgo(1)}`, patch);

    const rows = (await get('/api/trends?days=7')).json().days;
    const row = rows.find((d: { day: string }) => d.day === daysAgo(1));

    expect(row.goals_reviewed).toBe(false);
  });

  it('marks a day with only exercise as unreviewed rather than unknown', async () => {
    // A weight on file is required to log exercise now. Set it on an earlier day so
    // the day under test still carries nothing but the exercise itself.
    await put(`/api/day/${daysAgo(2)}`, { weight_lb: 195 });
    await post('/api/log/exercise', {
      activity: 'running',
      minutes: 30,
      date: daysAgo(1),
    });

    const rows = (await get('/api/trends?days=7')).json().days;
    const row = rows.find((d: { day: string }) => d.day === daysAgo(1));

    expect(row.weight_lb).toBeNull();
    expect(row.goals_reviewed).toBe(false);
  });

  it('reports per-day calories', async () => {
    await logOn(today, 12, 100, 1000); // 1000 cal

    const res = await get('/api/trends?days=7');
    const row = res.json().days.find((d: { day: string }) => d.day === today);

    expect(row.kcal).toBe(1000);
  });

  it('reports the weight trend per week', async () => {
    await put(`/api/day/${daysAgo(14)}`, { weight_lb: 196 });
    await put(`/api/day/${daysAgo(7)}`, { weight_lb: 195.5 });
    await put(`/api/day/${today}`, { weight_lb: 195 });

    const s = (await get('/api/trends?days=30')).json().summary;

    expect(s.weight_trend_per_week).toBe(-0.5);
    expect(s.latest_weight).toBe(195);
  });

  it('reports no weight trend from fewer than three weigh-ins', async () => {
    await put(`/api/day/${today}`, { weight_lb: 195 });

    expect((await get('/api/trends?days=30')).json().summary.weight_trend_per_week).toBeNull();
  });

  it('counts days under the calorie budget', async () => {
    await logOn(today, 12, 100, 1000); // under
    await logOn(daysAgo(1), 12, 100, 3000); // over

    const s = (await get('/api/trends?days=7')).json().summary;

    expect(s.days_logged).toBe(2);
    expect(s.days_under_budget).toBe(1);
  });

  it('computes eating-window compliance from the log', async () => {
    await logOn(today, 10, 100, 100);
    await logOn(today, 18, 100, 100); // compliant
    await logOn(daysAgo(1), 10, 100, 100);
    await logOn(daysAgo(1), 21, 100, 100); // ate too late

    const s = (await get('/api/trends?days=7')).json().summary;

    expect(s.window_compliance).toBe(50);
  });

  it('tracks the goal-review streak', async () => {
    await put(`/api/day/${today}`, { goals_reviewed: true });
    await put(`/api/day/${daysAgo(1)}`, { goals_reviewed: true });
    await put(`/api/day/${daysAgo(3)}`, { goals_reviewed: true }); // gap at day 2

    const s = (await get('/api/trends?days=7')).json().summary;

    // Counts back from today and stops at the gap, so the day-3 review doesn't count.
    expect(s.goals_review_streak).toBe(2);
  });

  it('reports a broken streak as zero even after a long run', async () => {
    for (let i = 1; i <= 5; i++) {
      await put(`/api/day/${daysAgo(i)}`, { goals_reviewed: true });
    }
    // Today is missed.

    expect((await get('/api/trends?days=7')).json().summary.goals_review_streak).toBe(0);
  });

  it('reports the share of days the goals were reviewed', async () => {
    await put(`/api/day/${today}`, { goals_reviewed: true });
    await put(`/api/day/${daysAgo(1)}`, { goals_reviewed: true });
    await logOn(daysAgo(2), 12, 100, 100); // logged, not reviewed

    // 2 of the 3 days with any record. The fourth day has nothing on it and is left
    // out of the denominator, so the figure matches the cells the strip draws.
    const s = (await get('/api/trends?days=4')).json().summary;

    expect(s.goals_review_rate).toBe(67);
    // The denominator travels with the rate so the screen can name it.
    expect(s.goals_review_days).toBe(3);
  });

  it('reads as zero rather than dividing by no days at all', async () => {
    const s = (await get('/api/trends?days=7')).json().summary;

    expect(s.goals_review_rate).toBe(0);
    expect(s.goals_review_days).toBe(0);
  });

  it('averages sleep, pairing each morning with the previous evening', async () => {
    await put(`/api/day/${daysAgo(1)}`, {
      sleep_start: Date.parse(`${daysAgo(1)}T22:00:00-08:00`),
    });
    await put(`/api/day/${today}`, { sleep_end: Date.parse(`${today}T06:00:00-08:00`) });

    expect((await get('/api/trends?days=7')).json().summary.avg_sleep_hours).toBe(8);
  });

  it('reaches back before the range for a bedtime that starts the first night', async () => {
    // The bedtime is a day outside the window; the hours still land on the first day.
    await put(`/api/day/${daysAgo(7)}`, {
      sleep_start: Date.parse(`${daysAgo(7)}T22:00:00-08:00`),
    });
    await put(`/api/day/${daysAgo(6)}`, {
      sleep_end: Date.parse(`${daysAgo(6)}T06:00:00-08:00`),
    });

    const rows = (await get('/api/trends?days=7')).json().days;
    expect(rows[0].day).toBe(daysAgo(6));
    expect(rows[0].sleep_hours).toBe(8);
  });

  it('averages burned calories over the days with exercise', async () => {
    await put(`/api/day/${today}`, { weight_lb: 195 });
    await post('/api/log/exercise', { activity: 'running', minutes: 30, date: today });

    // 195 lb, 30 min running: the same MET estimate exercised elsewhere.
    expect((await get('/api/trends?days=7')).json().summary.avg_burned).toBe(455);
  });

  it('reports nulls rather than zeros for averages with no data', async () => {
    const s = (await get('/api/trends?days=7')).json().summary;

    expect(s.avg_kcal).toBeNull();
    expect(s.avg_burned).toBeNull();
    expect(s.avg_sleep_hours).toBeNull();
    expect(s.window_compliance).toBe(0);
  });

  it('defaults to 30 days', async () => {
    expect((await get('/api/trends')).json().days).toHaveLength(30);
  });

  it.each([['0'], ['-5'], ['400'], ['abc'], ['1.5']])('rejects days=%s', async (days) => {
    expect((await get(`/api/trends?days=${days}`)).statusCode).toBe(400);
  });

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/trends' })).statusCode).toBe(401);
  });

  it("does not include another user's data", async () => {
    await logOn(today, 12, 100, 1000);
    await put(`/api/day/${today}`, { weight_lb: 195 });

    const other = await loginAs(app, db, 'someone-else');
    const res = await app.inject({
      method: 'GET',
      url: '/api/trends?days=7',
      headers: { cookie: other.cookie },
    });

    expect(res.json().summary.days_logged).toBe(0);
    expect(res.json().summary.latest_weight).toBeNull();
  });

  it('counts each day against the budget that was in force on it', async () => {
    // The chart colours bars by the per-row budget and the caption counts
    // days_under_budget. If those two used different numbers the page would
    // contradict itself, which is the whole reason the budget is on the row.
    putGoalPeriod(db, userId, {
      effective_from: '2020-01-01',
      kcal_budget: 3000,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });
    putGoalPeriod(db, userId, {
      effective_from: today,
      kcal_budget: 2000,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });

    // 2500 calories on each of two days: under 3000 yesterday, over 2000 today.
    await logOn(daysAgo(1), 12, 1000, 250);
    await logOn(today, 12, 1000, 250);

    const body = (await get('/api/trends?days=2')).json();

    expect(body.days.map((d: { budget: number }) => d.budget)).toEqual([3000, 2000]);
    expect(body.summary.days_under_budget).toBe(1);
    // The top-level figure is the current one, for the card heading.
    expect(body.budget).toBe(2000);
  });

  it('counts weights sessions per week, one per day', async () => {
    const d = daysAgo(1);
    // Calories burned come from the MET table scaled by body weight, so logging
    // exercise at all needs a weight on file first.
    await put(`/api/day/${d}`, { weight_lb: 195 });
    await post('/api/log/exercise', { activity: 'weights', minutes: 40, date: d });
    await post('/api/log/exercise', { activity: 'weights', minutes: 20, date: d });
    await post('/api/log/exercise', { activity: 'running', minutes: 30, date: d });

    const res = await get('/api/trends?days=14');
    const total = res
      .json()
      .weights_weeks.reduce((n: number, w: { count: number }) => n + w.count, 0);
    expect(total).toBe(1);
  });

  it('judges weights weeks against the target on their Monday', async () => {
    putGoalPeriod(db, userId, {
      effective_from: '2020-01-01',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: 2,
    });
    db.prepare('DELETE FROM goal_periods WHERE user_id = ? AND effective_from > ?').run(
      userId,
      '2020-01-01',
    );

    const res = await get('/api/trends?days=14');
    expect(res.json().weights_per_week).toBe(2);
    expect(res.json().weights_weeks.every((w: { target: number }) => w.target === 2)).toBe(true);
  });

  it('carries each day its own protein range, and counts days in it', async () => {
    db.prepare('DELETE FROM goal_periods WHERE user_id = ?').run(userId);
    putGoalPeriod(db, userId, {
      effective_from: '2020-01-01',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });
    putGoalPeriod(db, userId, {
      effective_from: daysAgo(2),
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: 1,
      protein_max_g: 400,
      weights_per_week: null,
    });

    // USDA_BANANA is 1.09 g protein per 100 g; 500 g of it is 5.45 g, which the
    // route rounds per day (as it rounds every macro) to 6 g — inside 1-400.
    await logOn(daysAgo(1), 12, 89, 500);
    await logOn(daysAgo(5), 12, 89, 500);

    const res = await get('/api/trends?days=7');
    const days = res.json().days;
    expect(days.find((r: { day: string }) => r.day === daysAgo(5)).protein_min_g).toBeNull();
    expect(days.find((r: { day: string }) => r.day === daysAgo(1)).protein_min_g).toBe(1);
    expect(res.json().summary.protein_days_with_target).toBe(1);
    expect(res.json().summary.protein_days_reaching_min).toBe(1);
    expect(res.json().summary.avg_protein_g).toBe(6);
  });

  it('counts a day above the maximum as reaching the minimum', async () => {
    db.prepare('DELETE FROM goal_periods WHERE user_id = ?').run(userId);
    putGoalPeriod(db, userId, {
      effective_from: '2020-01-01',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: 1,
      protein_max_g: 4,
      weights_per_week: null,
    });

    // 500 g of USDA_BANANA rounds to 6 g protein — above the max of 4, still >= the
    // min of 1, and "reaching the minimum" is all this count judges.
    await logOn(daysAgo(1), 12, 89, 500);

    const res = await get('/api/trends?days=7');
    expect(res.json().summary.protein_days_reaching_min).toBe(1);
  });

  it('leaves every week no_record when nothing at all has been logged', async () => {
    putGoalPeriod(db, userId, {
      effective_from: '2020-01-01',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: 2,
    });

    const res = await get('/api/trends?days=28');

    expect(res.json().weights_weeks.every((w: { state: string }) => w.state === 'no_record')).toBe(
      true,
    );
  });

  it('takes a week out of no_record once a day in it has any record', async () => {
    putGoalPeriod(db, userId, {
      effective_from: '2020-01-01',
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: 2,
    });
    await logOn(daysAgo(1), 12, 100, 100);

    const weeks = (await get('/api/trends?days=28')).json().weights_weeks;
    const loggedWeek = weeks.find(
      (w: { week_start: string }) => w.week_start === mondayOf(daysAgo(1)),
    );

    expect(loggedWeek.state).not.toBe('no_record');
  });

  it('does not count another account’s weights', async () => {
    const other = await loginAs(app, db, 'sam');
    await app.inject({
      method: 'PUT',
      url: `/api/day/${daysAgo(1)}`,
      payload: { weight_lb: 195 },
      headers: { cookie: other.cookie },
    });
    await app.inject({
      method: 'POST',
      url: '/api/log/exercise',
      payload: { activity: 'weights', minutes: 40, date: daysAgo(1) },
      headers: { cookie: other.cookie },
    });

    const res = await get('/api/trends?days=14');
    const total = res
      .json()
      .weights_weeks.reduce((n: number, w: { count: number }) => n + w.count, 0);
    expect(total).toBe(0);
  });
});
