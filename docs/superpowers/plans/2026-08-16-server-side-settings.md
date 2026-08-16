# Server-Side Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the goal numbers, the tracked-feature toggles, and the plan prose off the device and onto the account, with a Settings screen that edits them.

**Architecture:** Goals become effective-dated rows in a new `goal_periods` table, so a day is judged by the numbers in force on that day; the four goal columns come off `users`. Tracked features become five `track_*` columns on `users`, and the plan becomes a `plan_md` text column rendered from a tiny markdown subset. Three orphaned bits of schema — `no_meat`/`no_dairy`, two `note` columns, and the measured/estimated exercise split — are dropped on the way past.

**Tech Stack:** Fastify + better-sqlite3 + TypeScript (CommonJS) on the server; Vite + React + TypeScript (ESM) on the web. No new dependencies.

Design spec: `docs/superpowers/specs/2026-08-16-server-side-settings-design.md`.

## Global Constraints

- **Prettier**: 2-space indent, single quotes, semicolons, 100 columns. Run `npm run format`.
- **`npm run check` must pass before every commit.** It runs typecheck + vitest + eslint + format check across both packages.
- **Never edit an applied migration.** Add a new numbered `.sql` file in `server/src/migrations/`.
- **All SQL lives in `server/src/store.ts`.** Routes parse, call domain, persist, return. Arithmetic lives in `server/src/domain/`, which does no I/O.
- **Every query filters on `user_id`.** No exceptions, even with one account.
- **The test suite never hits the network.** USDA is always faked.
- **Both packages type-check their tests.** `server/tsconfig.test.json` covers `server/src/__tests__`; `web/tsconfig.json` already includes `web/src`.
- **Server is CommonJS, web is ESM. The two packages must never import each other.**
- This plan splits the spec's single "migration 005" into **three** migrations — `005`, `006`, `007` — so each task lands independently and none has to be edited after being applied.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `server/src/domain/goals.ts` | `Goals`/`GoalPeriod` types, `DEFAULT_GOALS`, `validateGoals`, `goalsForDay`. Pure. |
| `server/src/domain/features.ts` | `FEATURE_KEYS`, `Features`, the key→column map. Pure. |
| `server/src/routes/settings.ts` | `PUT /settings/goals`, `PUT /settings/features`, `GET`/`PUT /settings/plan`. |
| `server/src/migrations/005_goal_periods.sql` | `goal_periods` table, seeded, then drops the four goal columns. |
| `server/src/migrations/006_account_settings.sql` | Five `track_*` columns, `plan_md`, and the plan seed. |
| `server/src/migrations/007_drop_orphan_fields.sql` | Drops `no_meat`, `no_dairy`, both `note`s, `source`. |
| `server/src/__tests__/goals-domain.test.ts` | `validateGoals` and `goalsForDay`. |
| `server/src/__tests__/settings-route.test.ts` | The three settings routes, both scopes, isolation. |
| `web/src/markdown.ts` | `renderPlan(md)` → typed blocks. Pure. |
| `web/src/components/GoalsForm.tsx` | The budget/burn/window form and its two scope buttons. |
| `web/src/components/PlanEditor.tsx` | Textarea + Save/Cancel for the plan. |
| `web/src/__tests__/markdown.test.ts` | The renderer. |

**Modified:** `server/src/auth.ts`, `server/src/store.ts`, `server/src/app.ts`, `server/src/routes/auth.ts`, `server/src/routes/summary.ts`, `server/src/routes/trends.ts`, `server/src/routes/day.ts`, `server/src/domain/exercise.ts`, `server/src/scripts/seed-demo.ts`, `web/src/types.ts`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/settings.ts`, `web/src/screens/Settings.tsx`, `web/src/screens/Goals.tsx`, `web/src/screens/Trends.tsx`, `web/src/components/charts.tsx`, `web/src/components/DayInputs.tsx`, `web/src/styles.css`, `CLAUDE.md`, `docs/design.md`.

---

## Task 1: The goals domain module

**Files:**
- Create: `server/src/domain/goals.ts`
- Test: `server/src/__tests__/goals-domain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Goals { kcal_budget: number; burn_target: number; window_start: string; window_end: string }`
  - `interface GoalPeriod extends Goals { effective_from: string }`
  - `const DEFAULT_GOALS: Goals`
  - `function validateGoals(input: unknown): string | null` — an error message, or `null` when valid
  - `function goalsForDay(periods: GoalPeriod[], day: string): GoalPeriod`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/goals-domain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_GOALS, validateGoals, goalsForDay, type GoalPeriod } from '../domain/goals';

function period(effective_from: string, kcal_budget = 2400): GoalPeriod {
  return {
    effective_from,
    kcal_budget,
    burn_target: 960,
    window_start: '09:00',
    window_end: '19:00',
  };
}

describe('DEFAULT_GOALS', () => {
  it('is what migration 001 used as column defaults', () => {
    expect(DEFAULT_GOALS).toEqual({
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
    });
  });
});

describe('validateGoals', () => {
  it('accepts the defaults', () => {
    expect(validateGoals(DEFAULT_GOALS)).toBeNull();
  });

  it('rejects a budget outside the sane range', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 499 })).toContain('budget');
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 10001 })).toContain('budget');
  });

  it('rejects a burn target outside the sane range', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: -1 })).toContain('Burn');
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: 5001 })).toContain('Burn');
  });

  it('accepts the range edges themselves', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 500 })).toBeNull();
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 10000 })).toBeNull();
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: 0 })).toBeNull();
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: 5000 })).toBeNull();
  });

  it.each(['9:00', '09:60', '0900', 'morning', ''])('rejects %s as a time', (bad) => {
    expect(validateGoals({ ...DEFAULT_GOALS, window_start: bad })).toContain('HH:MM');
  });

  it('rejects a window that ends before it starts', () => {
    // domain/day.ts compares minutes-since-midnight and has no concept of a window
    // that wraps past midnight. Saying so here is what stops one being stored.
    const backwards = { ...DEFAULT_GOALS, window_start: '19:00', window_end: '09:00' };
    expect(validateGoals(backwards)).toContain('after');
  });

  it('rejects a zero-length window', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, window_start: '09:00', window_end: '09:00' })).toContain(
      'after',
    );
  });

  it('rejects anything that is not an object of the right shape', () => {
    expect(validateGoals(null)).not.toBeNull();
    expect(validateGoals('2400')).not.toBeNull();
    expect(validateGoals({ kcal_budget: 2400 })).not.toBeNull();
  });

  it('rejects a non-integer budget', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 2400.5 })).toContain('whole');
  });
});

describe('goalsForDay', () => {
  const periods = [period('2026-01-01', 2400), period('2026-06-01', 2200)];

  it('takes the latest period starting on or before the day', () => {
    expect(goalsForDay(periods, '2026-05-31').kcal_budget).toBe(2400);
    expect(goalsForDay(periods, '2026-08-16').kcal_budget).toBe(2200);
  });

  it('counts the first day of a period as inside it', () => {
    expect(goalsForDay(periods, '2026-06-01').kcal_budget).toBe(2200);
  });

  it('falls back to the earliest period for a day before all of them', () => {
    // seed-demo backdates six weeks of history behind the account creation date.
    // Those days are judged by the oldest goals on record rather than by nothing.
    expect(goalsForDay(periods, '2025-12-25').kcal_budget).toBe(2400);
  });

  it('does not care what order the periods arrive in', () => {
    expect(goalsForDay([...periods].reverse(), '2026-08-16').kcal_budget).toBe(2200);
  });

  it('returns the defaults when a user somehow has no periods at all', () => {
    // Should not happen — createUser seeds one — but a 500 on the day screen is a
    // worse answer than the numbers the account would have been created with.
    expect(goalsForDay([], '2026-08-16')).toEqual({ effective_from: '2026-08-16', ...DEFAULT_GOALS });
  });

  it('reports which period it chose, so a correction knows what to update', () => {
    expect(goalsForDay(periods, '2026-08-16').effective_from).toBe('2026-06-01');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix server -- goals-domain`
Expected: FAIL — `Cannot find module '../domain/goals'`

- [ ] **Step 3: Write the implementation**

Create `server/src/domain/goals.ts`:

```ts
/**
 * What you are aiming at, and when you were aiming at it.
 *
 * The numbers are effective-dated rather than current-only. The eating window is
 * derived per request from food timestamps, so evaluating it against whatever the
 * setting says *today* would let widening the window retroactively un-violate every
 * past day — right for fixing a typo, wrong for a real schedule change. The same is
 * true of the budget: trends counts days at or under it.
 *
 * So each day is judged by the period covering it, and editing says which of the two
 * it meant. See routes/settings.ts.
 */

export interface Goals {
  kcal_budget: number;
  burn_target: number;
  /** 24-hour HH:MM, local. */
  window_start: string;
  window_end: string;
}

/** A Goals with the first day it applied to. */
export interface GoalPeriod extends Goals {
  /** YYYY-MM-DD, local day. */
  effective_from: string;
}

/**
 * What an account starts with, from Personal/Mid-2026 Goals.md as it stood in
 * August 2026. These were column defaults in migration 001; with the columns gone
 * they need a home in code, and every new account is seeded from here.
 */
export const DEFAULT_GOALS: Goals = {
  kcal_budget: 2400,
  burn_target: 960,
  window_start: '09:00',
  window_end: '19:00',
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const BUDGET_MIN = 500;
const BUDGET_MAX = 10000;
const BURN_MAX = 5000;

/** Minutes since local midnight. Only ever called on a string HHMM_RE has passed. */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Returns the reason this is not a usable set of goals, or null when it is.
 *
 * A message rather than a thrown error or a boolean, because the route sends it
 * straight back as the 400 body and the form puts it on screen unchanged.
 */
export function validateGoals(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'Expected a set of goals';

  const g = input as Record<string, unknown>;

  if (typeof g.kcal_budget !== 'number' || !Number.isFinite(g.kcal_budget)) {
    return 'Calorie budget must be a number';
  }
  if (!Number.isInteger(g.kcal_budget)) return 'Calorie budget must be a whole number';
  if (g.kcal_budget < BUDGET_MIN || g.kcal_budget > BUDGET_MAX) {
    return `Calorie budget must be between ${BUDGET_MIN} and ${BUDGET_MAX}`;
  }

  if (typeof g.burn_target !== 'number' || !Number.isFinite(g.burn_target)) {
    return 'Burn target must be a number';
  }
  if (!Number.isInteger(g.burn_target)) return 'Burn target must be a whole number';
  if (g.burn_target < 0 || g.burn_target > BURN_MAX) {
    return `Burn target must be between 0 and ${BURN_MAX}`;
  }

  if (typeof g.window_start !== 'string' || !HHMM_RE.test(g.window_start)) {
    return 'Window start must be a time in HH:MM';
  }
  if (typeof g.window_end !== 'string' || !HHMM_RE.test(g.window_end)) {
    return 'Window end must be a time in HH:MM';
  }

  // domain/day.ts compares minutes since midnight and has no notion of a window
  // that wraps. A window that wraps would silently mark every day non-compliant.
  if (minutes(g.window_end) <= minutes(g.window_start)) {
    return 'Window end must be after window start';
  }

  return null;
}

/**
 * The goals in force on a given day: the latest period starting on or before it.
 *
 * Falls back to the earliest period rather than to nothing, so days behind the first
 * period — seed-demo backdates six weeks — are judged by the oldest goals on record
 * instead of failing. No sentinel date is needed anywhere as a result.
 */
export function goalsForDay(periods: GoalPeriod[], day: string): GoalPeriod {
  if (periods.length === 0) return { effective_from: day, ...DEFAULT_GOALS };

  const sorted = [...periods].sort((a, b) => a.effective_from.localeCompare(b.effective_from));

  let chosen = sorted[0];
  for (const p of sorted) {
    if (p.effective_from > day) break;
    chosen = p;
  }

  return chosen;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix server -- goals-domain`
Expected: PASS, 15 tests

- [ ] **Step 5: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/domain/goals.ts server/src/__tests__/goals-domain.test.ts
git commit -m "Add the goals domain module: defaults, validation, effective dating"
```

---

## Task 2: Migration 005 — goals move to goal_periods

Everything reads its goals through `goalsForDay` after this task. Behaviour is unchanged (there is one period per account), but the path is in place and effective dating is provable.

**Files:**
- Create: `server/src/migrations/005_goal_periods.sql`
- Modify: `server/src/auth.ts`, `server/src/store.ts`, `server/src/routes/summary.ts`, `server/src/routes/trends.ts`, `server/src/routes/auth.ts`
- Test: `server/src/__tests__/summary.test.ts`, `server/src/__tests__/trends-route.test.ts`, `server/src/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_GOALS`, `goalsForDay`, `Goals`, `GoalPeriod` from Task 1.
- Produces:
  - `store.listGoalPeriods(db, userId): GoalPeriod[]`
  - `store.putGoalPeriod(db, userId, period: GoalPeriod): void` — upsert on `(user_id, effective_from)`
  - `auth.User` is now `{ id, username, timezone }` — the four goal fields are gone
  - `GET /api/summary/:date` and `/api/trends` unchanged in shape, except each trends day row gains `budget: number`

- [ ] **Step 1: Write the migration**

Create `server/src/migrations/005_goal_periods.sql`:

```sql
-- The goal numbers become effective-dated, and move off users entirely.
--
-- They were four columns read live by summary and trends, which meant editing them
-- rewrote the past: widening the eating window retroactively un-violated every earlier
-- day, and lowering the budget un-passed them. That is right for fixing a typo and
-- wrong for a real schedule change, so each day is now judged by the period covering
-- it and the edit says which of the two it meant.
--
-- goal_periods is the only store. Keeping the columns as a live copy beside a history
-- would be two sources of truth for the same four numbers.
CREATE TABLE goal_periods (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,      -- YYYY-MM-DD, local day
  kcal_budget    INTEGER NOT NULL,
  burn_target    INTEGER NOT NULL,
  window_start   TEXT NOT NULL,
  window_end     TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_goal_periods ON goal_periods(user_id, effective_from);

-- Seed one period per existing account from the columns about to be dropped.
--
-- effective_from is the UTC day of created_at, not the local one: a .sql migration
-- cannot resolve an IANA timezone. Being a day out costs nothing, because this is the
-- earliest period and goalsForDay falls back to the earliest for anything before it.
INSERT INTO goal_periods (user_id, effective_from, kcal_budget, burn_target, window_start, window_end)
SELECT id,
       date(created_at / 1000, 'unixepoch'),
       daily_kcal_budget,
       daily_burn_target,
       window_start,
       window_end
FROM users;

ALTER TABLE users DROP COLUMN daily_kcal_budget;
ALTER TABLE users DROP COLUMN daily_burn_target;
ALTER TABLE users DROP COLUMN window_start;
ALTER TABLE users DROP COLUMN window_end;
```

- [ ] **Step 2: Write the failing tests**

Add to `server/src/__tests__/summary.test.ts` — a new `describe` block at the end of the file:

```ts
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
    });
    putGoalPeriod(db, userId, {
      effective_from: '2026-08-01',
      kcal_budget: 2200,
      burn_target: 900,
      window_start: '10:00',
      window_end: '20:00',
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
```

Add `putGoalPeriod` to that file's imports from `../store`.

In `server/src/__tests__/trends-route.test.ts`, this test goes **inside** the existing `describe('GET /api/trends')` block so it can use that block's `db`, `get`, `logOn`, `daysAgo` and `today` fixtures. Two small changes to the surrounding block first:

- add `let userId: number;` beside the other `let` declarations
- change the `beforeEach` line `({ cookie } = await loginAs(app, db, 'van'));` to `({ userId, cookie } = await loginAs(app, db, 'van'));`
- add `import { putGoalPeriod } from '../store';` (the file already imports `type DailyEntryPatch` from there — extend that import rather than adding a second)

Then add the test:

```ts
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
    });
    putGoalPeriod(db, userId, {
      effective_from: today,
      kcal_budget: 2000,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
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
```

In `server/src/__tests__/auth.test.ts:117`, replace the assertion:

```ts
expect(res.json().user).toMatchObject({ username: 'van' });
expect(res.json().goals).toMatchObject({ kcal_budget: 2400, window_start: '09:00' });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --prefix server`
Expected: FAIL — `putGoalPeriod` is not exported from `../store`

- [ ] **Step 4: Add the store functions**

In `server/src/store.ts`, add near the top imports:

```ts
import type { GoalPeriod } from './domain/goals';
```

Add a new section at the end of the file:

```ts
// ---------------------------------------------------------------- goal periods

/** Every set of goals this account has had, oldest first. */
export function listGoalPeriods(db: Db, userId: number): GoalPeriod[] {
  return db
    .prepare(
      `SELECT effective_from, kcal_budget, burn_target, window_start, window_end
       FROM goal_periods WHERE user_id = ? ORDER BY effective_from`,
    )
    .all(userId) as GoalPeriod[];
}

/**
 * Write the goals that took effect on a day, replacing whatever started that day.
 *
 * An upsert rather than an insert: editing twice in one day would otherwise collide
 * with the unique index. It is also what makes the two edit scopes converge once you
 * have already changed something today — the period covering today *is* the period
 * starting today, so both write this same row.
 */
export function putGoalPeriod(db: Db, userId: number, period: GoalPeriod): void {
  db.prepare(
    `INSERT INTO goal_periods
       (user_id, effective_from, kcal_budget, burn_target, window_start, window_end)
     VALUES (@user_id, @effective_from, @kcal_budget, @burn_target, @window_start, @window_end)
     ON CONFLICT(user_id, effective_from) DO UPDATE SET
       kcal_budget  = excluded.kcal_budget,
       burn_target  = excluded.burn_target,
       window_start = excluded.window_start,
       window_end   = excluded.window_end`,
  ).run({ user_id: userId, ...period });
}
```

- [ ] **Step 5: Narrow the User type and seed the first period**

In `server/src/auth.ts`, replace the `User` interface, `USER_COLUMNS`, and `createUser`:

```ts
import { DEFAULT_GOALS } from './domain/goals';
import { putGoalPeriod } from './store';

export interface User {
  id: number;
  username: string;
  timezone: string;
}

const USER_COLUMNS = 'id, username, timezone';
```

```ts
/**
 * Create an account and the goals it starts with, in one transaction.
 *
 * The period is seeded here rather than in scripts/create-user.ts because the test
 * helpers call this function too — so every account in every test has goals without
 * anyone having to arrange it.
 *
 * effective_from is the UTC day, matching migration 005 and for the same reason: it
 * is the earliest period, and goalsForDay falls back to the earliest for any day
 * behind it, so a day either way changes nothing.
 */
export async function createUser(db: Db, username: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  const now = Date.now();

  const create = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, now);

    const id = Number(info.lastInsertRowid);
    putGoalPeriod(db, id, {
      effective_from: new Date(now).toISOString().slice(0, 10),
      ...DEFAULT_GOALS,
    });
    return id;
  });

  return getUserById(db, create())!;
}
```

- [ ] **Step 6: Read goals through goalsForDay in summary**

In `server/src/routes/summary.ts`, add the imports:

```ts
import { goalsForDay } from '../domain/goals';
import { listFoodLog, listExercise, getDailyEntry, listGoalPeriods } from '../store';
```

Then, after the `previous` line, add:

```ts
const goals = goalsForDay(listGoalPeriods(opts.db, user.id), date);
```

and replace every `user.window_start` / `user.window_end` / `user.daily_kcal_budget` / `user.daily_burn_target` with `goals.window_start`, `goals.window_end`, `goals.kcal_budget`, `goals.burn_target`.

- [ ] **Step 7: Read goals through goalsForDay in trends**

In `server/src/routes/trends.ts`, add the imports:

```ts
import { goalsForDay } from '../domain/goals';
import { foodTotalsByDay, burnByDay, dailyEntriesInRange, listGoalPeriods } from '../store';
```

After `const entries = new Map(...)`, add:

```ts
// Loaded once for the whole range rather than per day. A range can span more than
// one set of goals, and every day must be judged by its own.
const periods = listGoalPeriods(opts.db, user.id);
```

Inside `range.map((day) => {`, add as the first line:

```ts
const goals = goalsForDay(periods, day);
```

Replace the `eatingWindow(...)` arguments `user.window_start, user.window_end` with `goals.window_start, goals.window_end`, and add `budget: goals.kcal_budget,` to the returned row object.

Replace the response's `budget` / `burn_target` and `days_under_budget`:

```ts
const current = goalsForDay(periods, today);
```

```ts
        budget: current.kcal_budget,
        burn_target: current.burn_target,
```

```ts
          days_under_budget: loggedDays.filter((r) => r.kcal! <= r.budget).length,
```

- [ ] **Step 8: Return goals from the auth routes**

In `server/src/routes/auth.ts`, add the imports:

```ts
import { goalsForDay } from '../domain/goals';
import { listGoalPeriods } from '../store';
import { localDay } from '../domain/day';
```

Add a helper above `registerAuthRoutes`:

```ts
/**
 * The goals in force today — what the Settings screen edits and the app measures by.
 *
 * Spelled out field by field rather than spread with effective_from dropped: the wire
 * shape is a Goals, and an unused destructured binding is the sort of thing eslint is
 * right to object to.
 */
function currentGoals(opts: AppOptions, user: { id: number; timezone: string }): Goals {
  const today = localDay(Date.now(), user.timezone);
  const period = goalsForDay(listGoalPeriods(opts.db, user.id), today);

  return {
    kcal_budget: period.kcal_budget,
    burn_target: period.burn_target,
    window_start: period.window_start,
    window_end: period.window_end,
  };
}
```

Import `type Goals` alongside `goalsForDay`.

Change the login route's return to `return { user, goals: currentGoals(opts, user) };` and the `/auth/me` return to `return { user: request.user, goals: currentGoals(opts, request.user!) };`.

- [ ] **Step 9: Run the tests**

Run: `npm test --prefix server`
Expected: PASS. If `summary.test.ts` or `trends-route.test.ts` fail on unrelated assertions, they are asserting the old `user.daily_kcal_budget` path — update those assertions to the new shape rather than reverting anything.

- [ ] **Step 10: Verify the migration applies to a real database**

```bash
cp data/app.db /tmp/app-before-005.db
npm run build --prefix server
node -e "require('./server/dist/db').openDatabase('/tmp/app-before-005.db')"
sqlite3 /tmp/app-before-005.db "PRAGMA foreign_keys=ON; SELECT * FROM goal_periods;"
sqlite3 /tmp/app-before-005.db "PRAGMA table_info(users);"
```

Expected: one `goal_periods` row per account carrying 2400 / 960 / 09:00 / 19:00, and `table_info(users)` no longer listing the four goal columns.

- [ ] **Step 11: Run the full check and commit**

Run: `npm run check`

```bash
git add server/src/migrations/005_goal_periods.sql server/src/store.ts server/src/auth.ts \
        server/src/routes/summary.ts server/src/routes/trends.ts server/src/routes/auth.ts \
        server/src/__tests__/
git commit -m "Move the goal numbers into effective-dated goal_periods"
```

---

## Task 3: The goals settings route

**Files:**
- Create: `server/src/routes/settings.ts`, `server/src/__tests__/settings-route.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `validateGoals`, `goalsForDay`, `Goals` (Task 1); `listGoalPeriods`, `putGoalPeriod` (Task 2).
- Produces: `PUT /api/settings/goals`, body `{ kcal_budget, burn_target, window_start, window_end, scope }` where `scope` is `'from_today' | 'correction'`; responds `{ goals: Goals }`. `registerSettingsRoutes(app, opts)` exported for `app.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/settings-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { testDb, testApp, loginAs } from './helpers';
import { listGoalPeriods } from '../store';
import { localDay, addDays } from '../domain/day';

const GOALS = {
  kcal_budget: 2200,
  burn_target: 900,
  window_start: '10:00',
  window_end: '20:00',
};

function today() {
  return localDay(Date.now(), 'America/Los_Angeles');
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
    const { cookie } = await loginAs(app, db, 'van');

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
    const { cookie } = await loginAs(app, db, 'van');

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix server -- settings-route`
Expected: FAIL — 404 on `PUT /api/settings/goals`

- [ ] **Step 3: Write the route**

Create `server/src/routes/settings.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay } from '../domain/day';
import { goalsForDay, validateGoals, type Goals } from '../domain/goals';
import { listGoalPeriods, putGoalPeriod } from '../store';

/**
 * How far back an edit reaches.
 *
 * `from_today` starts a new period today and leaves history judged by what it was
 * judged by at the time. `correction` rewrites the period covering today in place —
 * the covering one, not all of them, so fixing an October typo cannot quietly undo a
 * September schedule change.
 *
 * Once you have already edited today the two are the same row, and both do the same
 * thing. That is a property of the data rather than a case to handle.
 */
const SCOPES = ['from_today', 'correction'] as const;
type Scope = (typeof SCOPES)[number];

type GoalsBody = Goals & { scope?: string };

function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

export function registerSettingsRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.put<{ Body: GoalsBody }>(
    '/settings/goals',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const { scope, ...goals } = request.body ?? ({} as GoalsBody);

      if (!isScope(scope)) {
        return reply.code(400).send({ error: `scope must be one of ${SCOPES.join(', ')}` });
      }

      const problem = validateGoals(goals);
      if (problem) return reply.code(400).send({ error: problem });

      const today = localDay(Date.now(), user.timezone);
      const effective_from =
        scope === 'from_today'
          ? today
          : goalsForDay(listGoalPeriods(opts.db, user.id), today).effective_from;

      // Field by field rather than spread. `goals` is whatever survived the rest
      // destructuring of the request body, and better-sqlite3 throws on a named
      // parameter its statement does not use — a stray key in the JSON would be a
      // 500 rather than the 400 it deserves.
      const saved = {
        kcal_budget: goals.kcal_budget,
        burn_target: goals.burn_target,
        window_start: goals.window_start,
        window_end: goals.window_end,
      };

      putGoalPeriod(opts.db, user.id, { effective_from, ...saved });

      return { goals: saved };
    },
  );
}
```

- [ ] **Step 4: Register it**

In `server/src/app.ts`, add the import beside the others:

```ts
import { registerSettingsRoutes } from './routes/settings';
```

and the call inside the `/api` register block, after `registerAuthRoutes(api, opts);`:

```ts
      registerSettingsRoutes(api, opts);
```

- [ ] **Step 5: Run the tests**

Run: `npm test --prefix server -- settings-route`
Expected: PASS, 11 tests

- [ ] **Step 6: Run the full check and commit**

Run: `npm run check`

```bash
git add server/src/routes/settings.ts server/src/app.ts server/src/__tests__/settings-route.test.ts
git commit -m "Add PUT /settings/goals with from_today and correction scopes"
```

---

## Task 4: Migration 006 — tracked features and the plan

**Files:**
- Create: `server/src/migrations/006_account_settings.sql`, `server/src/domain/features.ts`
- Modify: `server/src/auth.ts`, `server/src/store.ts`, `server/src/routes/settings.ts`, `server/src/routes/auth.ts`
- Test: `server/src/__tests__/settings-route.test.ts`

**Interfaces:**
- Consumes: `registerSettingsRoutes` (Task 3).
- Produces:
  - `domain/features.ts`: `FEATURE_KEYS`, `type FeatureKey`, `type Features = Record<FeatureKey, boolean>`, `FEATURE_COLUMNS: Record<FeatureKey, string>`, `DEFAULT_FEATURES: Features`
  - `auth.User` gains `features: Features`
  - `store.setFeatures(db, userId, features: Features): void`
  - `store.getPlan(db, userId): string`, `store.setPlan(db, userId, plan: string): void`
  - `PUT /api/settings/features` → `{ features }`; `GET`/`PUT /api/settings/plan` → `{ plan }`

- [ ] **Step 1: Write the migration**

Create `server/src/migrations/006_account_settings.sql`. The `plan_md` seed is the text currently hardcoded in `web/src/screens/Goals.tsx`, transcribed to markdown:

```sql
-- Which parts of the day this account tracks, and the plan it is tracking against.
--
-- The toggles were per-device in localStorage, which was a deliberate choice at the
-- time and is deliberately reversed here: one account should mean one set of settings
-- on every device you sign into. Nothing is deleted when a feature goes off and
-- nothing stops being recorded — they still only decide what Today and Trends draw.
--
-- Columns rather than a JSON blob, matching the rest of the schema and making an
-- unrecognised key structurally impossible rather than something a test has to guard.
-- A sixth toggle later is one more line here.
ALTER TABLE users ADD COLUMN track_food     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_exercise INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_sleep    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_weight   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_goals    INTEGER NOT NULL DEFAULT 1;

-- The plan read on the Goals tab, in a markdown subset: ## headings, - bullets, and
-- blank-line paragraphs. Never parsed for meaning — the budget you are measured
-- against is the one in goal_periods, and writing a number here does nothing.
--
-- It was a hardcoded copy of Personal/Mid-2026 Goals.md. The app no longer takes that
-- note as its source of truth: a second account will want to write its own plan, and
-- there is no reason it should live in someone else's vault.
ALTER TABLE users ADD COLUMN plan_md TEXT NOT NULL DEFAULT '';

-- Carry the hardcoded plan onto every account that exists now, which is one. Accounts
-- created after this get the '' default and the empty state on the Goals tab.
UPDATE users SET plan_md = '## Calories

- Limit intake to about 2400 calories/day.
- Exercise enough to burn ~40% of that in calories (~960 cal/day from exercise).

## Eating window

- Only eat between 9:00 a.m. and 7:00 p.m.

## Diet

- Natural, whole foods — real foods as close as possible to how they are found in nature.
- Gold standard reference: the 80/10/10 diet (mostly raw fruits and vegetables). Not going full raw, but it is the north star.
- Allowances beyond raw: cooked grains like brown rice, steamed vegetables, and other relatively harmless cooked whole foods.
- Lots of fruits and vegetables.
- No dairy, no meat. Not going to sweat something like chicken broth in a veggie burrito — just no actual meat.
- Grains okay (e.g. brown rice), but not much bread.
- Avoid refined white flour, refined salt, refined sugar, and other highly processed ingredients.

## Environment / logistics

- Do not keep anything in the kitchen that I do not want to eat.
- Prepare ahead for what I will eat when I go out for a drive with my mother.

## Exercise

- Increase overall exercise to hit the 40%-of-calories target above.
- Keep up climbing twice a week.
- Keep up running three times a week.
- Add one weight workout a week.'
WHERE plan_md = '';
```

Before writing this, open `web/src/screens/Goals.tsx` and copy the `PLAN` array's strings verbatim — if any point has drifted from the text above, the file wins.

- [ ] **Step 2: Write the failing tests**

Add to `server/src/__tests__/settings-route.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --prefix server -- settings-route`
Expected: FAIL — `user.features` is undefined and `/api/settings/plan` 404s

- [ ] **Step 4: Write the features domain module**

Create `server/src/domain/features.ts`:

```ts
/**
 * Which parts of the day an account tracks.
 *
 * The list lives in one place so that validating a request body iterates it rather
 * than spelling the keys out again — the same property the web's FEATURES list has,
 * where nothingTracked() asks the list rather than a copy of it. A toggle added later
 * is validated, stored and counted without anyone remembering to come back.
 */
export const FEATURE_KEYS = ['food', 'exercise', 'sleep', 'weight', 'goals'] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

/** The column each key is stored in. */
export const FEATURE_COLUMNS: Record<FeatureKey, string> = {
  food: 'track_food',
  exercise: 'track_exercise',
  sleep: 'track_sleep',
  weight: 'track_weight',
  goals: 'track_goals',
};

/** Everything on — what migration 006 defaults to and what a new account gets. */
export const DEFAULT_FEATURES: Features = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
};
```

- [ ] **Step 5: Put features on the User**

In `server/src/auth.ts`:

```ts
import { FEATURE_COLUMNS, FEATURE_KEYS, type Features } from './domain/features';

export interface User {
  id: number;
  username: string;
  timezone: string;
  features: Features;
}

const USER_COLUMNS = `id, username, timezone, ${FEATURE_KEYS.map((k) => FEATURE_COLUMNS[k]).join(', ')}`;

type UserRow = { id: number; username: string; timezone: string } & Record<string, number>;

/**
 * The five feature flags ride along on the user row because getSessionUser calls this
 * on every authenticated request. Five integers on a row already being fetched are
 * free; the goals are a second table and the plan can run to kilobytes, so neither is
 * here. Routes that need those ask for them.
 */
function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    timezone: row.timezone,
    features: Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, !!row[FEATURE_COLUMNS[key]]]),
    ) as Features,
  };
}

export function getUserById(db: Db, id: number): User | undefined {
  const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as
    | UserRow
    | undefined;

  return row ? toUser(row) : undefined;
}
```

- [ ] **Step 6: Add the store functions**

In `server/src/store.ts`, add the import:

```ts
import { FEATURE_COLUMNS, FEATURE_KEYS, type Features } from './domain/features';
```

and a new section at the end:

```ts
// ---------------------------------------------------------------- account settings

/** Write all five toggles at once. Reading them is part of getUserById. */
export function setFeatures(db: Db, userId: number, features: Features): void {
  const assignments = FEATURE_KEYS.map((key) => `${FEATURE_COLUMNS[key]} = ?`).join(', ');
  const values = FEATURE_KEYS.map((key) => (features[key] ? 1 : 0));

  db.prepare(`UPDATE users SET ${assignments} WHERE id = ?`).run(...values, userId);
}

/** The plan prose. Kept off the User because it loads on every authenticated request. */
export function getPlan(db: Db, userId: number): string {
  const row = db.prepare('SELECT plan_md FROM users WHERE id = ?').get(userId) as
    | { plan_md: string }
    | undefined;

  return row?.plan_md ?? '';
}

export function setPlan(db: Db, userId: number, plan: string): void {
  db.prepare('UPDATE users SET plan_md = ? WHERE id = ?').run(plan, userId);
}
```

- [ ] **Step 7: Add the routes**

In `server/src/routes/settings.ts`, add the imports:

```ts
import { FEATURE_KEYS, type Features } from '../domain/features';
import { listGoalPeriods, putGoalPeriod, setFeatures, getPlan, setPlan } from '../store';
```

and a constant plus two route groups inside `registerSettingsRoutes`:

```ts
/** Longer than anyone reads at arms length on a phone, and short of a paste accident. */
const PLAN_MAX_CHARS = 50_000;
```

```ts
  app.put<{ Body: Record<string, unknown> }>(
    '/settings/features',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const body = request.body ?? {};

      // Built key by key from FEATURE_KEYS rather than taken wholesale, so a body
      // missing one is a 400 and an unrecognised one simply never arrives.
      const features = {} as Features;
      for (const key of FEATURE_KEYS) {
        if (typeof body[key] !== 'boolean') {
          return reply.code(400).send({ error: `${key} must be true or false` });
        }
        features[key] = body[key] as boolean;
      }

      setFeatures(opts.db, request.user!.id, features);
      return { features };
    },
  );

  app.get('/settings/plan', { preHandler: app.requireUser }, async (request) => ({
    plan: getPlan(opts.db, request.user!.id),
  }));

  app.put<{ Body: { plan?: unknown } }>(
    '/settings/plan',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const plan = (request.body ?? {}).plan;

      if (typeof plan !== 'string') return reply.code(400).send({ error: 'plan must be text' });
      if (plan.length > PLAN_MAX_CHARS) {
        return reply.code(400).send({ error: `plan must be under ${PLAN_MAX_CHARS} characters` });
      }

      setPlan(opts.db, request.user!.id, plan);
      return { plan };
    },
  );
```

- [ ] **Step 8: Run the tests**

Run: `npm test --prefix server`
Expected: PASS

- [ ] **Step 9: Verify the plan seed against a real database**

```bash
cp data/app.db /tmp/app-before-006.db
npm run build --prefix server
node -e "require('./server/dist/db').openDatabase('/tmp/app-before-006.db')"
sqlite3 /tmp/app-before-006.db "SELECT substr(plan_md, 1, 60), length(plan_md) FROM users;"
sqlite3 /tmp/app-before-006.db "SELECT track_food, track_goals FROM users;"
```

Expected: the plan starting `## Calories`, a length around 1300, and both toggles `1`.

- [ ] **Step 10: Run the full check and commit**

Run: `npm run check`

```bash
git add server/src/migrations/006_account_settings.sql server/src/domain/features.ts \
        server/src/auth.ts server/src/store.ts server/src/routes/settings.ts \
        server/src/__tests__/settings-route.test.ts
git commit -m "Move tracked features and the plan text onto the account"
```

---

## Task 5: Migration 007 — drop the orphaned fields

**Files:**
- Create: `server/src/migrations/007_drop_orphan_fields.sql`
- Modify: `server/src/store.ts`, `server/src/routes/day.ts`, `server/src/routes/summary.ts`, `server/src/domain/exercise.ts`, `server/src/scripts/seed-demo.ts`
- Test: `server/src/__tests__/summary.test.ts`, `server/src/__tests__/exercise.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `store.DailyEntry` is `{ local_day, weight_lb, sleep_start, sleep_end, goals_reviewed }`; `store.ExerciseEntry` is `{ id, local_day, logged_at, activity, minutes, kcal }`; `GET /summary/:date`'s `exercise` object is `{ entries, total, target }`; `summarizeBurn` and `BurnSummary` no longer exist.

- [ ] **Step 1: Write the migration**

Create `server/src/migrations/007_drop_orphan_fields.sql`:

```sql
-- Five fields with server plumbing and nothing on the other end.
--
-- no_meat / no_dairy were check-in boxes removed from the UI as more nagging than
-- useful, leaving columns, patch fields, coercion, types on both sides and seed writes
-- behind them. With the plan now prose each account writes for itself, two fixed
-- columns naming one person's diet rules are the wrong shape for the schema besides.
--
-- The two note columns never had a UI at all: nothing has ever written or shown them.
--
-- source recorded whether exercise calories came from a watch or the MET table. The
-- form stopped asking, so every real row has been 'estimated' since — the split only
-- looked alive because seed-demo fabricated measured rows. Exercise calories are a MET
-- estimate scaled by body weight, and the schema now says so. The consequence is that
-- POST /log/exercise can no longer be given a calorie figure, so needing a weight on
-- file is not escapable and its 400 stops offering an alternative that is gone.
--
-- SQLite drops a column-level CHECK along with its column, so source needs no rebuild.
ALTER TABLE daily_entries DROP COLUMN no_meat;
ALTER TABLE daily_entries DROP COLUMN no_dairy;
ALTER TABLE daily_entries DROP COLUMN note;
ALTER TABLE exercise_log  DROP COLUMN note;
ALTER TABLE exercise_log  DROP COLUMN source;
```

- [ ] **Step 2: Write the failing test**

Add to `server/src/__tests__/summary.test.ts`:

```ts
describe('dropped fields', () => {
  it('does not report a day with fields nothing writes', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({ method: 'GET', url: `/api/summary/${DAY}`, headers: { cookie } });
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
```

Then delete the existing assertions in that file that reference `no_meat` / `no_dairy` — around lines 61-62, 73, 80, 86-89, 255 and 270. In each case remove the field from the object or the whole `it` block if the field was its entire subject.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --prefix server -- summary`
Expected: FAIL — the summary still carries `no_meat` and `measuredShare`

- [ ] **Step 4: Strip the fields from the store**

In `server/src/store.ts`:

```ts
export interface ExerciseEntry {
  id: number;
  local_day: string;
  logged_at: number;
  activity: string;
  minutes: number;
  kcal: number;
}
```

```ts
export function insertExercise(db: Db, userId: number, entry: NewExercise): number {
  const info = db
    .prepare(
      `INSERT INTO exercise_log (user_id, local_day, logged_at, activity, minutes, kcal)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, entry.local_day, entry.logged_at, entry.activity, entry.minutes, entry.kcal);

  return Number(info.lastInsertRowid);
}

export function listExercise(db: Db, userId: number, localDay: string): ExerciseEntry[] {
  return db
    .prepare(
      `SELECT id, local_day, logged_at, activity, minutes, kcal
       FROM exercise_log
       WHERE user_id = ? AND local_day = ?
       ORDER BY logged_at`,
    )
    .all(userId, localDay) as ExerciseEntry[];
}
```

```ts
export interface DailyEntry {
  local_day: string;
  weight_lb: number | null;
  sleep_start: number | null;
  sleep_end: number | null;
  goals_reviewed: boolean;
}

export type DailyEntryPatch = Partial<Omit<DailyEntry, 'local_day'>>;

const DAILY_FIELDS = ['weight_lb', 'sleep_start', 'sleep_end', 'goals_reviewed'] as const;

const BOOLEAN_FIELDS = new Set(['goals_reviewed']);

interface DailyRow {
  local_day: string;
  weight_lb: number | null;
  sleep_start: number | null;
  sleep_end: number | null;
  goals_reviewed: number;
}
```

In `getDailyEntry`, drop `no_meat, no_dairy, note` from the `SELECT`, drop them from the all-blank fallback object, and reduce the mapping to `{ ...row, goals_reviewed: !!row.goals_reviewed }`. Do the same in `dailyEntriesInRange`.

- [ ] **Step 5: Replace summarizeBurn with a sum**

In `server/src/domain/exercise.ts`, delete `summarizeBurn` and the `BurnSummary` interface entirely. The split it existed to compute is gone, and totalling a list of numbers does not need a domain function.

In `server/src/routes/summary.ts`, remove the `summarizeBurn` import and replace `const burn = summarizeBurn(exercise);` with:

```ts
const burned = Math.round(exercise.reduce((sum, e) => sum + e.kcal, 0));
```

and the exercise block of the response with:

```ts
        exercise: {
          entries: exercise,
          total: burned,
          target: goals.burn_target,
        },
```

In `server/src/__tests__/exercise.test.ts`, delete the `summarizeBurn` describe block.

- [ ] **Step 6: Drop the watch-number branch from the day route**

In `server/src/routes/day.ts`, remove `kcal` from `ExerciseBody` and replace the branch at lines 89-106 with:

```ts
      // Calories come from the MET table scaled by current body weight. There is no
      // second source any more, so a weight on file is required rather than preferred.
      const weight = latestWeight(opts.db, user.id, day);
      if (weight === null) {
        return reply.code(400).send({ error: 'Record a weight first' });
      }

      const kcal = estimateKcal(body.activity, body.minutes, weight);
```

and drop `source` and `note` from the `insertExercise` call.

- [ ] **Step 7: Update seed-demo**

In `server/src/scripts/seed-demo.ts`, remove `no_meat: true,` and `no_dairy: random() < 0.93,` from the `upsertDailyEntry` call, and replace the exercise block with:

```ts
      insertExercise(db, user.id, {
        local_day: day,
        logged_at: new Date(midnight).setHours(WORKOUT_HOUR, 30),
        activity: workout.activity,
        minutes: workout.minutes,
        kcal: estimateKcal(workout.activity, workout.minutes, reading),
      });
```

- [ ] **Step 8: Run the tests**

Run: `npm test --prefix server`
Expected: PASS. Any remaining failure will be a test still naming a dropped field — remove the field from that assertion.

- [ ] **Step 9: Verify the migration against a real database**

```bash
cp data/app.db /tmp/app-before-007.db
npm run build --prefix server
node -e "require('./server/dist/db').openDatabase('/tmp/app-before-007.db')"
sqlite3 /tmp/app-before-007.db "PRAGMA table_info(exercise_log); PRAGMA table_info(daily_entries);"
```

Expected: neither table lists `note`, `daily_entries` has no `no_meat`/`no_dairy`, `exercise_log` has no `source`.

- [ ] **Step 10: Run the full check and commit**

Run: `npm run check`

```bash
git add server/src/migrations/007_drop_orphan_fields.sql server/src/store.ts \
        server/src/routes/day.ts server/src/routes/summary.ts server/src/domain/exercise.ts \
        server/src/scripts/seed-demo.ts server/src/__tests__/
git commit -m "Drop no_meat, no_dairy, both note columns, and the measured/estimated split"
```

---

## Task 6: Web types, api, and App wiring

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/settings.ts`, `web/src/App.tsx`
- Test: `web/src/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: `/api/auth/me` → `{ user: User; goals: Goals }`, `PUT /api/settings/features`, `PUT /api/settings/goals` (Tasks 3-4).
- Produces:
  - `types.ts`: `interface Goals`, `interface User { id, username, timezone, features: Settings }`
  - `api.putFeatures(features)`, `api.putGoals(goals, scope)`, `api.getPlan()`, `api.putPlan(plan)`
  - `settings.ts`: `clearLegacySettings()`; `readSettings`/`writeSettings` gone
  - `App` passes `settings`, `onChangeSettings`, `settingsError`, `goals`, `onSaveGoals`, `onLogout` to `Settings`

- [ ] **Step 1: Write the failing test**

Replace the contents of `web/src/__tests__/settings.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearLegacySettings,
  nothingTracked,
  DEFAULT_SETTINGS,
  FEATURES,
  type Settings,
} from '../settings';

const ALL_ON: Settings = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
};

describe('clearLegacySettings', () => {
  beforeEach(() => localStorage.clear());

  it('removes the per-device toggles this app used to keep', () => {
    // They are not adopted: the server's defaults win, once. Deleting the key stops
    // an old value reappearing if this ever reads localStorage again.
    localStorage.setItem('health:settings', JSON.stringify({ exercise: false }));
    clearLegacySettings();
    expect(localStorage.getItem('health:settings')).toBeNull();
  });

  it('is fine when there is nothing to remove', () => {
    expect(() => clearLegacySettings()).not.toThrow();
  });
});

describe('nothingTracked', () => {
  const ALL_OFF = Object.fromEntries(FEATURES.map((f) => [f.key, false])) as unknown as Settings;

  it('is false with everything on', () => {
    expect(nothingTracked(ALL_ON)).toBe(false);
  });

  it('is true only once the last feature goes off', () => {
    expect(nothingTracked(ALL_OFF)).toBe(true);
  });

  it.each(FEATURES.map((f) => f.key))('stays false while %s is still on', (key) => {
    expect(nothingTracked({ ...ALL_OFF, [key]: true })).toBe(false);
  });

  it('counts every feature the settings screen offers', () => {
    // Guards the shortcut in nothingTracked: it asks FEATURES rather than a list of
    // its own, so a toggle added later must not be able to slip past it. This matters
    // more now, not less — the keys are columns, and the server has its own list.
    expect(FEATURES.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix web -- settings`
Expected: FAIL — `clearLegacySettings` is not exported

- [ ] **Step 3: Rewrite settings.ts**

In `web/src/settings.ts`, replace the file header comment and everything from `const KEY` to the end:

```ts
/**
 * Which parts of the day this account tracks.
 *
 * Turning one off only hides it. Nothing is deleted and nothing stops being
 * recorded server-side, so switching a feature back on brings its history with it —
 * these are a question about what is worth looking at, not about what is true.
 *
 * Stored on the account rather than on the device. It used to be the other way and
 * that was a deliberate choice; it is deliberately reversed, because one account
 * should mean one set of settings on every device you sign into. The values ride
 * along on the user from /auth/me; this module is now the list and the arithmetic.
 */
```

```ts
const LEGACY_KEY = 'health:settings';

/**
 * Remove the per-device copy this app used to keep.
 *
 * The toggles that were on a phone before this change are not adopted — the server's
 * defaults win, and five checkboxes are seconds to re-set once. Deleting the key is
 * what stops a stale value from ever being read again.
 */
export function clearLegacySettings(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Private mode and similar can throw. A key that will not clear is not worth a
    // screen that will not render.
  }
}
```

Delete `readSettings`, `writeSettings` and the `bool` helper. Keep `Settings`, `DEFAULT_SETTINGS`, `FEATURES` and `nothingTracked` exactly as they are.

- [ ] **Step 4: Update the web types**

In `web/src/types.ts`, replace the `User` interface and add `Goals`:

```ts
import type { Settings } from './settings';

/** What you are aiming at today. Past days are judged by what was in force then. */
export interface Goals {
  kcal_budget: number;
  burn_target: number;
  window_start: string;
  window_end: string;
}

export interface User {
  id: number;
  username: string;
  timezone: string;
  /** Which features this account tracks. Same shape as the local Settings type. */
  features: Settings;
}
```

In the same file, remove `no_meat` and `no_dairy` and `note` from `DayEntry`, remove `note` and `source` from `ExerciseEntry`, and reduce `DaySummary['exercise']` to:

```ts
  exercise: {
    entries: ExerciseEntry[];
    total: number;
    target: number;
  };
```

- [ ] **Step 5: Add the api calls**

In `web/src/api.ts`, add the imports and the new members:

```ts
import type { Goals, User } from './types';
import type { Settings } from './settings';
```

```ts
  login: (username: string, password: string) =>
    request<{ user: User; goals: Goals }>('POST', '/auth/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  me: () => request<{ user: User; goals: Goals }>('GET', '/auth/me'),

  putFeatures: (features: Settings) =>
    request<{ features: Settings }>('PUT', '/settings/features', features),
  putGoals: (goals: Goals, scope: 'from_today' | 'correction') =>
    request<{ goals: Goals }>('PUT', '/settings/goals', { ...goals, scope }),
  getPlan: () => request<{ plan: string }>('GET', '/settings/plan'),
  putPlan: (plan: string) => request<{ plan: string }>('PUT', '/settings/plan', { plan }),
```

`Login.tsx` calls `api.login` and passes the user up — check whether it destructures `{ user }`; if so it now needs `{ user, goals }` and an extra callback argument. Change `onLoggedIn` to `(user: User, goals: Goals) => void` and pass both.

- [ ] **Step 6: Wire App to the server**

In `web/src/App.tsx`, replace the settings imports and state:

```ts
import { clearLegacySettings, type Settings as SettingsValue } from './settings';
import type { Goals, User } from './types';
```

```ts
  const [goals, setGoals] = useState<Goals | null>(null);
  const [settingsError, setSettingsError] = useState('');
```

Delete the `settings` state and `changeSettings` as they stand, and add:

```ts
  /**
   * Optimistic: the toggle moves at once and the request follows, because a switch
   * that waits for a round trip feels broken on a phone. A failure puts it back and
   * says why — nothing is queued for later, in line with sw.js, which caches the app
   * shell and deliberately no API writes.
   */
  const changeSettings = useCallback(
    async (next: SettingsValue) => {
      if (!user) return;

      // The user object from this render is what gets put back on failure. Capturing
      // it inside a setUser updater instead would be wrong: StrictMode runs updaters
      // twice in dev, and the second run would read the already-flipped value and
      // "restore" the change rather than undo it.
      setUser({ ...user, features: next });

      try {
        await api.putFeatures(next);
        setSettingsError('');
      } catch (err) {
        setUser(user);
        setSettingsError(err instanceof Error ? err.message : 'Could not save that');
      }
    },
    [user],
  );

  const saveGoals = useCallback(async (next: Goals, scope: 'from_today' | 'correction') => {
    const { goals: saved } = await api.putGoals(next, scope);
    setGoals(saved);
  }, []);
```

In the boot effect, take both halves of the response and clear the legacy key:

```ts
  useEffect(() => {
    clearLegacySettings();

    api
      .me()
      .then(({ user, goals }) => {
        setUser(user);
        setGoals(goals);
        setDate(todayIn(user.timezone));
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setChecking(false));
  }, []);
```

Change `handleLoggedIn(next: User)` to `handleLoggedIn(next: User, nextGoals: Goals)` and have it `setGoals(nextGoals)` as well.

Everywhere `settings` was passed down, pass `user.features`. Guard the render on `goals` alongside `user` and `date`:

```ts
  if (!user || !date || !goals) return <Login onLoggedIn={handleLoggedIn} />;
```

and render Settings as:

```tsx
        {tab === 'settings' && (
          <Settings
            settings={user.features}
            onChange={changeSettings}
            error={settingsError}
            goals={goals}
            onSaveGoals={saveGoals}
            onLogout={logout}
          />
        )}
```

- [ ] **Step 7: Run the tests**

Run: `npm test --prefix web`
Expected: PASS. `Settings.tsx` will not type-check yet against the new props — that is Task 7, so if `tsc` fails only on `screens/Settings.tsx`, continue to Task 7 and commit both together.

- [ ] **Step 8: Commit**

Deferred to Task 7 — the two halves do not type-check apart.

---

## Task 7: The Settings screen

**Files:**
- Create: `web/src/components/GoalsForm.tsx`
- Modify: `web/src/screens/Settings.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `Goals`, `Settings`, `FEATURES` (Task 6).
- Produces: `<GoalsForm goals onSave />` where `onSave: (goals: Goals, scope: 'from_today' | 'correction') => Promise<void>`; `<Settings settings onChange error goals onSaveGoals onLogout />`.

- [ ] **Step 1: Write the goals form**

Create `web/src/components/GoalsForm.tsx`:

```tsx
import { useState } from 'react';
import type { Goals } from '../types';

type Scope = 'from_today' | 'correction';

/**
 * The three numbers the day is measured against.
 *
 * Saving asks how far back the change reaches, because the app cannot tell a typo
 * from a schedule change and the two want opposite things: fixing 2400 typed as 240
 * should repair every day it spoiled, while moving the window in September should
 * leave August judged by the window August was lived under.
 *
 * The choice only appears once something has actually changed, and disappears again
 * on cancel — a form that asks a question about an edit nobody made is noise.
 */
export function GoalsForm({
  goals,
  onSave,
}: {
  goals: Goals;
  onSave: (goals: Goals, scope: Scope) => Promise<void>;
}) {
  const [budget, setBudget] = useState(String(goals.kcal_budget));
  const [burn, setBurn] = useState(String(goals.burn_target));
  const [start, setStart] = useState(goals.window_start);
  const [end, setEnd] = useState(goals.window_end);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const edited: Goals = {
    kcal_budget: Number(budget),
    burn_target: Number(burn),
    window_start: start,
    window_end: end,
  };

  const changed =
    edited.kcal_budget !== goals.kcal_budget ||
    edited.burn_target !== goals.burn_target ||
    edited.window_start !== goals.window_start ||
    edited.window_end !== goals.window_end;

  function reset() {
    setBudget(String(goals.kcal_budget));
    setBurn(String(goals.burn_target));
    setStart(goals.window_start);
    setEnd(goals.window_end);
    setAsking(false);
    setError('');
  }

  async function save(scope: Scope) {
    setBusy(true);
    try {
      await onSave(edited, scope);
      setAsking(false);
      setError('');
    } catch (err) {
      // Edits stay on screen: you pressed a button, and you can press it again.
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title card-title-tight">Goals</div>

      <div className="field-rows">
        <label className="field-row">
          <span className="field-label">Calorie budget</span>
          <span className="field-input">
            <input
              type="number"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <span className="field-unit">cal</span>
          </span>
        </label>

        <label className="field-row">
          <span className="field-label">Burn target</span>
          <span className="field-input">
            <input
              type="number"
              inputMode="numeric"
              value={burn}
              onChange={(e) => setBurn(e.target.value)}
            />
            <span className="field-unit">cal</span>
          </span>
        </label>

        <div className="field-row">
          <span className="field-label">Eating window</span>
          <span className="field-input">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <span className="field-unit">to</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {changed && !asking && (
        <div className="row row-end">
          <button className="btn-ghost tiny" onClick={reset} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => setAsking(true)} disabled={busy}>
            Save
          </button>
        </div>
      )}

      {asking && (
        <div className="stack-tight">
          <div className="tiny faint">
            Past days are judged by the goals you had at the time. Which is this?
          </div>
          <div className="row row-end">
            <button className="btn" onClick={() => save('from_today')} disabled={busy}>
              From today onward
            </button>
            <button className="btn-ghost tiny" onClick={() => save('correction')} disabled={busy}>
              Fix a mistake — apply to past days too
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the Settings screen**

Replace `web/src/screens/Settings.tsx`:

```tsx
import { FEATURES, type Settings as SettingsValue } from '../settings';
import { GoalsForm } from '../components/GoalsForm';
import type { Goals } from '../types';

/**
 * What this account is aiming at, what it tracks, and the way out of the app.
 *
 * All of it lives on the account rather than the device now, so a change here follows
 * you to every phone and browser you sign in from — and needs the network to happen at
 * all. Nothing is queued: a toggle that could not be saved goes back where it was and
 * says so, rather than sitting there looking saved.
 */
export function Settings({
  settings,
  onChange,
  error,
  goals,
  onSaveGoals,
  onLogout,
}: {
  settings: SettingsValue;
  onChange: (next: SettingsValue) => void;
  /** Why the last toggle did not stick, if it did not. */
  error: string;
  goals: Goals;
  onSaveGoals: (goals: Goals, scope: 'from_today' | 'correction') => Promise<void>;
  onLogout: () => void;
}) {
  return (
    <div className="stack">
      <h1 className="screen-title">Settings</h1>

      <GoalsForm goals={goals} onSave={onSaveGoals} />

      <div className="card">
        <div className="card-title card-title-tight">Track</div>
        <div className="toggles">
          {FEATURES.map((f) => (
            <label className="toggle" key={f.key}>
              <span className="toggle-text">
                <span className="toggle-label">{f.label}</span>
                <span className="toggle-detail">{f.detail}</span>
              </span>
              <input
                type="checkbox"
                className="toggle-input"
                checked={settings[f.key]}
                onChange={(e) => onChange({ ...settings, [f.key]: e.target.checked })}
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </label>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="tiny faint toggle-note">
          Turning one off only hides it from the day. Nothing already logged is deleted, and it all
          comes back if you turn it on again.
        </div>
      </div>

      <div className="tiny faint">
        These are settings for your account, not for this phone — they follow you to every device
        you sign in from, which means saving one needs a connection.
      </div>

      {/* Last on the page. Spaced by the stack alone, like everything else here. */}
      <div className="row row-end">
        <button className="btn-ghost tiny" onClick={onLogout}>
          Log Out
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the styles**

In `web/src/styles.css`, add near the other form styles. Match the surrounding conventions — read the file's existing `.toggle` and `.card` rules first and follow their spacing and custom-property use rather than the literal values here:

```css
.field-rows {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.field-label {
  flex: 1;
}

.field-input {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.field-input input {
  width: 6rem;
  text-align: right;
}

.field-input input[type='time'] {
  width: 7rem;
  text-align: left;
}

.field-unit {
  color: var(--muted);
  font-size: 0.85em;
}

.stack-tight {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit Tasks 6 and 7 together**

```bash
git add web/src/types.ts web/src/api.ts web/src/settings.ts web/src/App.tsx \
        web/src/screens/Settings.tsx web/src/screens/Login.tsx \
        web/src/components/GoalsForm.tsx web/src/styles.css web/src/__tests__/settings.test.ts
git commit -m "Read settings from the account, and give the goals a form to edit them in"
```

---

## Task 8: Per-day budgets in the calorie chart

**Files:**
- Modify: `web/src/components/charts.tsx`, `web/src/screens/Trends.tsx`
- Test: `web/src/__tests__/charts.test.ts` (create)

**Interfaces:**
- Consumes: the trends response's per-row `budget` (Task 2).
- Produces: `CalorieChart({ points }: { points: (Series & { budget: number })[] })`; exported `stepPath(points, geom)` for the test.

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/charts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stepPath } from '../components/charts';

/** A geometry stub: x is the index times ten, y is the value negated. */
const geom = {
  x: (i: number) => i * 10,
  y: (v: number) => -v,
};

/** Every distinct height the path visits, in the order-free sense that matters here. */
function heightsIn(path: string): Set<string> {
  return new Set(
    path
      .split(/[ML]/)
      .map((segment) => segment.trim().split(/\s+/)[1])
      .filter(Boolean),
  );
}

describe('stepPath', () => {
  it('stays at one height when the budget never changes', () => {
    const d = stepPath([{ budget: 2400 }, { budget: 2400 }, { budget: 2400 }], geom, 0, 100);
    expect(heightsIn(d)).toEqual(new Set(['-2400']));
  });

  it('visits both heights when the budget changes', () => {
    // The change happens at one x rather than sloping across the gap — the budget
    // was one number and then another, never anything in between.
    const d = stepPath([{ budget: 3000 }, { budget: 2000 }], geom, 0, 100);
    expect(heightsIn(d)).toEqual(new Set(['-3000', '-2000']));
  });

  it('spans the full plot width', () => {
    const d = stepPath([{ budget: 2400 }, { budget: 2400 }], geom, 5, 95);
    expect(d.startsWith('M 5 ')).toBe(true);
    expect(d.trimEnd().endsWith('95 -2400')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix web -- charts`
Expected: FAIL — `stepPath` is not exported

- [ ] **Step 3: Implement the stepped reference line**

In `web/src/components/charts.tsx`, add above `CalorieChart`:

```tsx
/**
 * A stepped line through a per-point value, held flat across each point and jumping
 * at the midpoint between two that differ.
 *
 * Stepped rather than sloped because the budget was one number and then another —
 * there was never a day it was 2300 on the way down.
 */
export function stepPath(
  points: { budget: number }[],
  geom: { x: (i: number) => number; y: (v: number) => number },
  left: number,
  right: number,
): string {
  const boundary = (i: number) => (geom.x(i - 1) + geom.x(i)) / 2;

  let d = '';
  points.forEach((p, i) => {
    const y = geom.y(p.budget);
    const x0 = i === 0 ? left : boundary(i);
    const x1 = i === points.length - 1 ? right : boundary(i + 1);
    // The L back to x0 at the new height is the riser; when the height has not
    // changed it is a zero-length segment and draws nothing.
    d += `${i === 0 ? 'M' : 'L'} ${x0} ${y} L ${x1} ${y} `;
  });

  return d;
}
```

Replace `CalorieChart`:

```tsx
/**
 * Daily calories against the budget. Position already says whether a bar cleared
 * the reference line; the color reinforces it rather than carrying it alone.
 *
 * The budget rides on each point rather than being one number for the chart, because
 * a range can span a change to it. Colouring bars against today's figure while the
 * caption below counted them per day would have the page contradicting itself.
 */
export function CalorieChart({ points }: { points: (Series & { budget: number })[] }) {
  if (points.every((p) => p.value === null)) {
    return <div className="empty tiny">Nothing logged in this range yet.</div>;
  }

  return (
    <ChartFrame
      points={points}
      // Zero baseline, and the axis must reach every budget in the range even on a
      // week where every day came in under all of them.
      scale={{ fromZero: true, include: points.map((p) => p.budget) }}
      tooltip={(i) => (
        <>
          <div className="chart-tip-day">{longDay(points[i].day)}</div>
          <div className="chart-tip-value">
            {points[i].value === null ? 'nothing logged' : `${points[i].value} cal`}
          </div>
        </>
      )}
    >
      {(geom) => (
        <>
          <path
            d={stepPath(points, geom, PAD.left, geom.width - PAD.right)}
            fill="none"
            className="chart-ref"
          />
          {points.map((p, i) => {
            if (p.value === null) return null;
            const top = geom.y(p.value);
            const base = geom.baseline;
            return (
              <rect
                key={p.day}
                x={geom.x(i) - geom.barWidth / 2}
                y={top}
                width={geom.barWidth}
                height={Math.max(2, base - top)}
                rx={Math.min(4, geom.barWidth / 2)}
                className={p.value > p.budget ? 'chart-bar chart-bar-over' : 'chart-bar'}
              />
            );
          })}
        </>
      )}
    </ChartFrame>
  );
}
```

`.chart-ref` is currently styled for a `<line>`; check `web/src/styles.css` and add `fill: none;` to that rule if it is not already there, so the path does not fill.

- [ ] **Step 4: Pass the budgets through Trends**

In `web/src/screens/Trends.tsx`, add `budget: number` to the day-row type in the local `Trends` interface, and change the chart call:

```tsx
          <CalorieChart
            points={data.days.map((d) => ({ day: d.day, value: d.kcal, budget: d.budget }))}
          />
```

Leave the card heading's `budget {data.budget}` as it is — that is the current figure, which is what a heading should say.

- [ ] **Step 5: Run the tests**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/charts.tsx web/src/screens/Trends.tsx web/src/__tests__/charts.test.ts web/src/styles.css
git commit -m "Colour each calorie bar against its own day's budget"
```

---

## Task 9: The markdown renderer

**Files:**
- Create: `web/src/markdown.ts`, `web/src/__tests__/markdown.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Block = { kind: 'heading'; text: string } | { kind: 'bullets'; items: string[] } | { kind: 'paragraph'; text: string }`; `function renderPlan(md: string): Block[]`.

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderPlan } from '../markdown';

describe('renderPlan', () => {
  it('is empty for an empty plan', () => {
    expect(renderPlan('')).toEqual([]);
    expect(renderPlan('   \n\n  ')).toEqual([]);
  });

  it('reads a heading', () => {
    expect(renderPlan('## Calories')).toEqual([{ kind: 'heading', text: 'Calories' }]);
  });

  it('groups consecutive bullets into one list', () => {
    expect(renderPlan('- one\n- two\n- three')).toEqual([
      { kind: 'bullets', items: ['one', 'two', 'three'] },
    ]);
  });

  it('starts a new list after a heading', () => {
    expect(renderPlan('- a\n\n## Next\n\n- b')).toEqual([
      { kind: 'bullets', items: ['a'] },
      { kind: 'heading', text: 'Next' },
      { kind: 'bullets', items: ['b'] },
    ]);
  });

  it('joins wrapped lines into one paragraph', () => {
    expect(renderPlan('one line\nand its continuation')).toEqual([
      { kind: 'paragraph', text: 'one line and its continuation' },
    ]);
  });

  it('splits paragraphs on a blank line', () => {
    expect(renderPlan('first\n\nsecond')).toEqual([
      { kind: 'paragraph', text: 'first' },
      { kind: 'paragraph', text: 'second' },
    ]);
  });

  it('leaves unsupported syntax as the text it is', () => {
    // The subset is deliberately three things. Anything else is a plan someone wrote,
    // not a directive, and showing it verbatim is more honest than half-honouring it.
    expect(renderPlan('**bold** and [a link](http://x)')).toEqual([
      { kind: 'paragraph', text: '**bold** and [a link](http://x)' },
    ]);
    expect(renderPlan('# One hash')).toEqual([{ kind: 'paragraph', text: '# One hash' }]);
    expect(renderPlan('* star bullet')).toEqual([{ kind: 'paragraph', text: '* star bullet' }]);
  });

  it('does not treat a bare dash or hashes as an empty item', () => {
    expect(renderPlan('-')).toEqual([{ kind: 'paragraph', text: '-' }]);
    expect(renderPlan('##')).toEqual([{ kind: 'paragraph', text: '##' }]);
  });

  it('tolerates carriage returns and trailing space', () => {
    expect(renderPlan('## Calories  \r\n- one  \r\n')).toEqual([
      { kind: 'heading', text: 'Calories' },
      { kind: 'bullets', items: ['one'] },
    ]);
  });

  it('handles the whole shape of a real plan', () => {
    const md = ['## Calories', '', '- About 2400 a day.', '- Burn about 960.', '', 'Roughly.'].join(
      '\n',
    );

    expect(renderPlan(md)).toEqual([
      { kind: 'heading', text: 'Calories' },
      { kind: 'bullets', items: ['About 2400 a day.', 'Burn about 960.'] },
      { kind: 'paragraph', text: 'Roughly.' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix web -- markdown`
Expected: FAIL — `Cannot find module '../markdown'`

- [ ] **Step 3: Write the renderer**

Create `web/src/markdown.ts`:

```ts
/**
 * The plan, turned into blocks a component can draw.
 *
 * A deliberately tiny subset: `## headings`, `- bullets`, and blank-line-separated
 * paragraphs. No bold, no links, no images. With nothing inline to parse this is a
 * line classifier and a grouping pass, and a block holds a string rather than a tree —
 * emphasis in a document one person reads to themselves is not worth doubling this
 * file and its tests to buy.
 *
 * Anything outside the subset comes out as the text it is, which is also why the
 * renderer can hand these to React as plain children: with no links or images in the
 * grammar there is nothing a plan could inject, and no reason to reach for
 * dangerouslySetInnerHTML.
 *
 * Never parsed for meaning. The budget you are measured against is the one in
 * Settings; writing a number in here does nothing.
 */

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'paragraph'; text: string };

const HEADING = /^##\s+(.+)$/;
const BULLET = /^-\s+(.+)$/;

export function renderPlan(md: string): Block[] {
  const blocks: Block[] = [];

  // Held open across lines so consecutive bullets become one list and wrapped prose
  // becomes one paragraph. A blank line, a heading, or a change of kind closes it.
  let bullets: string[] | null = null;
  let paragraph: string[] | null = null;

  const closeParagraph = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = null;
  };

  const closeBullets = () => {
    if (bullets) blocks.push({ kind: 'bullets', items: bullets });
    bullets = null;
  };

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();

    if (line === '') {
      closeBullets();
      closeParagraph();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeBullets();
      closeParagraph();
      blocks.push({ kind: 'heading', text: heading[1].trim() });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      closeParagraph();
      bullets = bullets ?? [];
      bullets.push(bullet[1].trim());
      continue;
    }

    closeBullets();
    paragraph = paragraph ?? [];
    paragraph.push(line);
  }

  closeBullets();
  closeParagraph();

  return blocks;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --prefix web -- markdown`
Expected: PASS, 10 tests

- [ ] **Step 5: Run the full check and commit**

Run: `npm run check`

```bash
git add web/src/markdown.ts web/src/__tests__/markdown.test.ts
git commit -m "Add a three-rule markdown renderer for the plan"
```

---

## Task 10: The Goals tab reads and edits the plan

**Files:**
- Create: `web/src/components/PlanEditor.tsx`
- Modify: `web/src/screens/Goals.tsx`, `web/src/components/DayInputs.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `renderPlan`, `Block` (Task 9); `api.getPlan`, `api.putPlan` (Task 6).
- Produces: `<PlanEditor initial onSave onCancel />` where `onSave: (plan: string) => Promise<void>`.

- [ ] **Step 1: Write the editor**

Create `web/src/components/PlanEditor.tsx`:

```tsx
import { useState } from 'react';

const PLACEHOLDER = `## Calories

- what you are aiming at

## Eating window

- when you will eat`;

/**
 * One textarea for the whole plan.
 *
 * A box you type into rather than a form of sections and bullets: a plan is prose, and
 * editing a long one through per-bullet inputs on a phone is slower than typing.
 *
 * The placeholder is the only teaching there is for the format. It shows the two rules
 * that matter and nothing else, because there is nothing else.
 */
export function PlanEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (plan: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    try {
      await onSave(text);
    } catch (err) {
      // What you typed stays in the box. Nothing is queued to retry on your behalf.
      setError(err instanceof Error ? err.message : 'Could not save your plan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title card-title-tight">Your plan</div>
      <textarea
        className="plan-editor"
        value={text}
        placeholder={PLACEHOLDER}
        onChange={(e) => setText(e.target.value)}
        rows={18}
      />
      <div className="tiny faint">
        Start a section with <code>##</code> and a point with <code>-</code>. Everything else shows
        as you typed it.
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row row-end">
        <button className="btn-ghost tiny" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render the plan on the Goals tab**

In `web/src/screens/Goals.tsx`, delete the `Section` interface and the whole `PLAN` constant, and replace the file header comment with:

```tsx
/**
 * The plan, read here and edited here.
 *
 * It used to be a hardcoded copy of "The Plan" from Personal/Mid-2026 Goals.md. It is
 * the account's own text now: a second account will want to write its own, and there
 * is no reason it should live in someone else's vault. Keeping any outside note in
 * step is a personal habit the app knows nothing about.
 */
```

Add the imports:

```tsx
import { renderPlan } from '../markdown';
import { PlanEditor } from '../components/PlanEditor';
```

Add state and a fetch beside the existing recording effect:

```tsx
  const [plan, setPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .getPlan()
      .then(({ plan: loaded }) => {
        if (!cancelled) setPlan(loaded);
      })
      .catch(() => {
        if (!cancelled) setPlanError('Could not load your plan.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function savePlan(next: string) {
    const { plan: saved } = await api.putPlan(next);
    setPlan(saved);
    setEditing(false);
  }
```

Replace the `{PLAN.map(...)}` block with:

```tsx
      {planError && <div className="error">{planError}</div>}

      {editing && plan !== null && (
        <PlanEditor initial={plan} onSave={savePlan} onCancel={() => setEditing(false)} />
      )}

      {!editing && plan !== null && plan.trim() === '' && (
        <div className="card">
          <div className="card-title">No plan yet</div>
          <p className="empty-note">
            Write down what you are aiming at and it shows up here, to read at arm&rsquo;s length in
            the morning.
          </p>
          <div className="row row-end">
            <button className="btn" onClick={() => setEditing(true)}>
              Write my plan
            </button>
          </div>
        </div>
      )}

      {!editing && plan !== null && plan.trim() !== '' && (
        <>
          {renderPlan(plan).map((block, i) => {
            if (block.kind === 'heading') {
              return (
                <div className="card-title plan-heading" key={i}>
                  {block.text}
                </div>
              );
            }
            if (block.kind === 'bullets') {
              return (
                <div className="card" key={i}>
                  <ul className="plan-list">
                    {block.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              );
            }
            return (
              <div className="card" key={i}>
                <p className="plan-paragraph">{block.text}</p>
              </div>
            );
          })}

          <div className="row row-end">
            <button className="btn-ghost tiny" onClick={() => setEditing(true)}>
              Edit plan
            </button>
          </div>
        </>
      )}
```

- [ ] **Step 3: Add the styles**

In `web/src/styles.css`, following the conventions already in the file:

```css
.plan-editor {
  width: 100%;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  resize: vertical;
}

.plan-heading {
  margin-top: 0.25rem;
}

.plan-paragraph {
  margin: 0;
}
```

- [ ] **Step 4: Drop the stale comment in DayInputs**

In `web/src/components/DayInputs.tsx`, replace the `ExerciseInput` doc comment — the second paragraph describes an API that no longer exists after Task 5:

```tsx
/**
 * Log a workout: activity and duration. Calories come from the MET table scaled
 * by current body weight, which is the only way they are ever arrived at.
 */
```

- [ ] **Step 5: Run the check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/screens/Goals.tsx web/src/components/PlanEditor.tsx \
        web/src/components/DayInputs.tsx web/src/styles.css
git commit -m "Read and edit the plan on the Goals tab"
```

---

## Task 11: Documentation, and looking at it

**Files:**
- Modify: `CLAUDE.md`, `docs/design.md`

- [ ] **Step 1: Update CLAUDE.md**

Four edits:

1. **Opening paragraph** — replace the first two paragraphs (from "A personal food, exercise…" through "…worth skimming before a big change.") with:

```markdown
A personal food, exercise, sleep, and weight tracker. Phone-first PWA, one user (Van).
Live at **https://health.hovercloud.com** since 2026-08-16, and also runs locally.

**The goals live in the app, per account.** The calorie budget, daily burn target and
eating window are rows in `goal_periods`, edited on the Settings screen; the plan itself
is markdown in `users.plan_md`, written and read on the Goals tab. It started as a copy
of `Personal/Mid-2026 Goals.md` in the Obsidian vault at `~/dev/personal` — 2400 cal/day,
~960 burned, a 9am–7pm window, whole foods / no meat / no dairy — and that note is still
worth reading for the reasoning behind those numbers. It is no longer the source of
truth: a second account writes its own plan, and there is no reason it should live in
someone else's vault. Keeping the note in step is a habit now, not a coupling.
```

2. **The `src/settings.ts` bullet** under `web/` — replace it with:

```markdown
  - `src/settings.ts` — which features this account tracks (diet, exercise, sleep,
    weight, goals). **Per-account, on the server** — five `track_*` columns on `users`,
    arriving with the user from `/auth/me`. This was per-device in `localStorage`, and
    the reasoning for that was written down and argued for; it was deliberately reversed
    in migration 006, because one account should mean one set of settings on every
    device you sign into. The toggles already on a phone were **not** adopted — the
    server's defaults won once, and `clearLegacySettings()` deletes the old key on boot.
    Nothing is deleted or stops being recorded when a feature goes off; it only decides
    what `Today` and `Trends` draw, so turning one back on brings its whole history with
    it. `nothingTracked()` still asks `FEATURES` rather than a list of its own, so a
    toggle added later is counted without anyone remembering to — and `domain/features.ts`
    gives the server the same property for validating and storing them.
```

3. **Two new entries under "Things that are subtle"**:

```markdown
**Goals are effective-dated, and editing asks how far back it reaches.** The eating
window and the budget are evaluated per request, so changing them would otherwise
re-judge every past day — right for fixing a typo, wrong for a real schedule change.
`goal_periods` holds each set with the day it took effect, `goalsForDay` picks the one
covering a day (falling back to the earliest, so seeded history behind the first period
still resolves), and Save offers *from today onward* against *fix a mistake*. A
correction rewrites the period covering **today**, not all of them, so fixing an October
typo cannot undo a September change. Once you have edited today the two are the same row
and do the same thing.

**Settings need the network and nothing is queued.** A toggle moves at once and goes
back if the write fails; the goal form and the plan editor keep your edits on screen.
This is the same call `sw.js` makes about the app shell — a setting that looks saved and
is not is worse than one that says it could not be.
```

4. **Delete the `no_meat` / `no_dairy` bullet** from "Data model notes", and add one line noting that `goal_periods` is the only store for the goal numbers.

- [ ] **Step 2: Update docs/design.md**

Six places:
- **line 5** — opens by making the vault note the premise. Reframe: the note is where the numbers came from; the app owns them now, per account.
- **lines 68-69** — remove the four goal columns from the `users` sketch, add the five `track_*` columns and `plan_md`, and add a `goal_periods` line.
- **line 80** — drop `source` and `note` from `exercise_log`.
- **line 82** — drop `no_meat`, `no_dairy`, `note` from `daily_entries`.
- **line 108** — the Goals tab shows the account's own plan, not the vault note's.
- **line 177** — the note no longer stays the source of truth for the goals.

- [ ] **Step 3: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Look at it**

Per CLAUDE.md, several bugs here type-checked and tested fine and were only caught on screen. Make a throwaway account, seed it, and drive it:

```bash
./dev.sh   # in one terminal
npm run create-user --prefix server -- shot
npm run seed-demo --prefix server -- shot
```

With Playwright against the installed Chrome (`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`, viewport 390x844, deviceScaleFactor 3, colorScheme 'dark'), check:

1. **Settings** — the goals form, the toggles, and the account note all fit the phone width. Measure rather than eyeball: no element has `scrollWidth > clientWidth`.
2. **Saving a goal change** — the two scope buttons appear only after an edit, and both fit on the line without clipping.
3. **A toggle failing** — stop the API (`Ctrl-C` on `dev.sh`), tap a toggle, confirm it goes back and the error appears rather than sitting there looking saved.
4. **Trends after a `from_today` change** — set the budget to something well below the seeded days, then confirm the calorie chart's reference line steps at today rather than sloping, and that the caption's count matches the bars that are actually red.
5. **The Goals tab** — the seeded account has an empty plan, so confirm the empty state, write a short plan with a heading and bullets, save, and confirm it renders. Then check that `**bold**` shows literally.
6. **Nothing tracked** — turn all five toggles off and confirm both Today and Trends show the `NothingTracked` card.

Then delete the account:

```bash
sqlite3 data/app.db "PRAGMA foreign_keys = ON; DELETE FROM users WHERE username='shot';"
rm -f data/audio/goals-*
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/design.md
git commit -m "Document account settings, effective dating, and the decoupled plan"
```

---

## Deployment note

This is three migrations against a live database with real data. Before `git pull` on the VPS, take a backup — `scripts/backup.sh` covers `app.db` and the `audio/` directory. Migrations run at startup inside `rebuild-restart-production.sh`, each in its own transaction, so a failure leaves the database on the last good version. Verify afterwards:

```bash
sqlite3 /home/griljor/health-data/app.db "SELECT * FROM goal_periods;"
sqlite3 /home/griljor/health-data/app.db "SELECT length(plan_md) FROM users;"
```

Expected: one period per account at 2400 / 960 / 09:00 / 19:00, and a non-zero plan length for the existing account. And re-run `chmod -R o+r web/dist` after the build, as ever.
