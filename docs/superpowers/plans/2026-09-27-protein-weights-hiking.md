# Protein target, weights per week, and hiking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settable 90–130 g protein target (dated, with a nested Diet → Macros → Protein toggle), a weights-sessions-per-week target counted by Mon–Sun week on Trends, and hiking as an activity.

**Architecture:** Three nullable columns on `goal_periods` carry the targets through the existing effective-dated machinery (`goalsForDay`, the from-today/correction scope). Two `track_*` columns on `users` carry the new toggles; nesting is purely a web concern (`isOn`). All arithmetic — validation, week bucketing, the protein bar's state — is pure and tested; routes and components stay thin.

**Tech Stack:** Fastify + better-sqlite3 + TypeScript (server, CommonJS), Vite + React + TypeScript (web), vitest, hand-rolled SVG charts.

**Spec:** `docs/superpowers/specs/2026-09-27-protein-weights-hiking-design.md`

## Global Constraints

- Read `CLAUDE.md` first. Every rule there applies — especially "routes stay thin", "every query filters on `user_id`", "never edit an applied migration".
- `npm run check` (from repo root) must pass before every commit.
- Prettier: 2-space, single quotes, semicolons, 100 columns. Run `npm run format` before committing.
- Server and web must not import each other.
- Existing goal periods get **null** targets. `DEFAULT_GOALS` targets are **null**.
- Amber (`--warn`) is **not** used anywhere in this feature. The protein yellow is not used for the protein progress bar.
- "Off" hides and keeps: no toggle deletes or rewrites data.
- Commit messages: plain imperative sentence, no `feat:` prefix (match `git log`), ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016u3cENE3ogUK1CFM88mEr2
  ```
- Run server tests with `npm test --prefix server`, web tests with `npm test --prefix web`. A single file: `npx vitest run src/__tests__/<file> --prefix server` does not work — use `cd server && npx vitest run src/__tests__/<file>` (likewise `web`).

## File map

| File | Change |
|---|---|
| `server/src/domain/exercise.ts` | `hiking` activity |
| `server/src/domain/goals.ts` | three nullable fields, validation |
| `server/src/migrations/009_protein_weights.sql` | new |
| `server/src/store.ts` | goal period columns, `weightsDays` |
| `server/src/routes/settings.ts` | goals merge-absent; features partial |
| `server/src/routes/auth.ts` | `currentGoals` carries new fields |
| `server/src/domain/features.ts` | `macros`, `protein` keys |
| `server/src/routes/summary.ts` | `food.protein` |
| `server/src/domain/trend.ts` | `mondayOf`, `weeklySessions` |
| `server/src/routes/trends.ts` | protein per day + summary, `weights_weeks` |
| `server/src/scripts/seed-demo.ts` | workouts match the new plan |
| `web/src/settings.ts` | `macros`, `protein`, `parent`, `isOn` |
| `web/src/types.ts` | Goals fields, `DaySummary.food.protein` |
| `web/src/screens/Settings.tsx`, `web/src/styles.css` | nested toggles |
| `web/src/components/GoalsForm.tsx` | protein + weights rows |
| `web/src/components/ProteinBar.tsx` | new — `proteinBar()` + component |
| `web/src/screens/Today.tsx` | bar, title, collapsed summary |
| `web/src/components/charts.tsx` | `ProteinChart`, `WeeksStrip` |
| `web/src/screens/Trends.tsx` | protein card, weights card |
| `CLAUDE.md` | notes and test counts |

---

### Task 1: Hiking

**Files:**
- Modify: `server/src/domain/exercise.ts:13-20`
- Test: `server/src/__tests__/exercise.test.ts`

**Interfaces:**
- Produces: `ACTIVITIES.hiking = { label: 'Hiking', met: 6.0 }`, so `ActivityId` includes `'hiking'`.

- [ ] **Step 1: Write the failing test** — append to `server/src/__tests__/exercise.test.ts`:

```ts
describe('hiking', () => {
  it('is an activity, at the Compendium cross-country MET', () => {
    expect(isActivity('hiking')).toBe(true);
    expect(ACTIVITIES.hiking).toEqual({ label: 'Hiking', met: 6.0 });
  });

  it('sits right after climbing in the picker', () => {
    const ids = Object.keys(ACTIVITIES);
    expect(ids.indexOf('hiking')).toBe(ids.indexOf('climbing') + 1);
  });
});
```

Make sure `ACTIVITIES` and `isActivity` are in the file's import from `../domain/exercise`.

- [ ] **Step 2: Run it — expect FAIL** (`cd server && npx vitest run src/__tests__/exercise.test.ts`): `isActivity('hiking')` is false.

- [ ] **Step 3: Implement** — in `ACTIVITIES`, after `climbing`:

```ts
  climbing: { label: 'Climbing', met: 8.0 },
  // Compendium 17080, "hiking, cross country".
  hiking: { label: 'Hiking', met: 6.0 },
```

Update the doc comment above `ACTIVITIES` to say the list follows the plan as revised in September 2026 (hiking in, running reduced, weights 2–3×).

- [ ] **Step 4: Run it — expect PASS.** Then `npm run check`.

- [ ] **Step 5: Commit** — `git add -A server && git commit` with message `Add hiking as an activity`.

---

### Task 2: Goals domain — protein range and weights per week

**Files:**
- Modify: `server/src/domain/goals.ts`
- Test: `server/src/__tests__/goals-domain.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Goals {
    kcal_budget: number; burn_target: number; window_start: string; window_end: string;
    protein_min_g: number | null; protein_max_g: number | null; weights_per_week: number | null;
  }
  // GoalPeriod extends Goals { effective_from: string }  (unchanged shape otherwise)
  DEFAULT_GOALS  // new fields all null
  validateGoals(input: unknown): string | null  // same contract, more rules
  ```

- [ ] **Step 1: Update the existing tests for the new shape.** In `goals-domain.test.ts`, the `period()` helper and the `DEFAULT_GOALS` expectation gain the three fields:

```ts
function period(effective_from: string, kcal_budget = 2400): GoalPeriod {
  return {
    effective_from,
    kcal_budget,
    burn_target: 960,
    window_start: '09:00',
    window_end: '19:00',
    protein_min_g: null,
    protein_max_g: null,
    weights_per_week: null,
  };
}

describe('DEFAULT_GOALS', () => {
  it('is what migration 001 used as column defaults, with no protein or weights target', () => {
    expect(DEFAULT_GOALS).toEqual({
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });
  });
});
```

- [ ] **Step 2: Write the failing tests** — append:

```ts
describe('validateGoals — protein range', () => {
  const withProtein = (min: unknown, max: unknown) => ({
    ...DEFAULT_GOALS,
    protein_min_g: min,
    protein_max_g: max,
  });

  it('accepts no range at all', () => {
    expect(validateGoals(withProtein(null, null))).toBeNull();
  });

  it('accepts a range, and a range of one value', () => {
    expect(validateGoals(withProtein(90, 130))).toBeNull();
    expect(validateGoals(withProtein(100, 100))).toBeNull();
  });

  it('refuses one end without the other', () => {
    expect(validateGoals(withProtein(90, null))).toBe(
      'Set both ends of the protein range, or neither',
    );
    expect(validateGoals(withProtein(null, 130))).toBe(
      'Set both ends of the protein range, or neither',
    );
  });

  it('refuses a range that runs backwards', () => {
    expect(validateGoals(withProtein(130, 90))).toContain('Protein');
  });

  it('refuses zero, fractions, and absurd amounts', () => {
    expect(validateGoals(withProtein(0, 130))).toContain('Protein');
    expect(validateGoals(withProtein(90.5, 130))).toContain('whole');
    expect(validateGoals(withProtein(90, 401))).toContain('Protein');
    expect(validateGoals(withProtein('90', 130))).toContain('Protein');
  });

  it('accepts the edges', () => {
    expect(validateGoals(withProtein(1, 400))).toBeNull();
  });
});

describe('validateGoals — weights per week', () => {
  const withWeights = (n: unknown) => ({ ...DEFAULT_GOALS, weights_per_week: n });

  it('accepts no target, zero, and up to fourteen', () => {
    expect(validateGoals(withWeights(null))).toBeNull();
    // Zero is a real target — a rest week — met by doing nothing.
    expect(validateGoals(withWeights(0))).toBeNull();
    expect(validateGoals(withWeights(14))).toBeNull();
  });

  it('refuses negatives, fractions, and more than twice a day', () => {
    expect(validateGoals(withWeights(-1))).toContain('Weights');
    expect(validateGoals(withWeights(2.5))).toContain('whole');
    expect(validateGoals(withWeights(15))).toContain('Weights');
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (type errors on `DEFAULT_GOALS` shape, then the new cases).

- [ ] **Step 4: Implement** in `server/src/domain/goals.ts`:

```ts
export interface Goals {
  kcal_budget: number;
  burn_target: number;
  /** 24-hour HH:MM, local. */
  window_start: string;
  window_end: string;
  /**
   * Grams a day, both ends inclusive; both null means no target. A range rather than a
   * share of calories because the September 2026 plan is set in grams per kilogram,
   * which no percentage of a varying intake can express.
   */
  protein_min_g: number | null;
  protein_max_g: number | null;
  /** Days with a weights session per Mon–Sun week. Null is no target; 0 is a rest week. */
  weights_per_week: number | null;
}
```

`DEFAULT_GOALS` gains the three as `null`, with a comment: these are specific to one person's revised plan and are not handed to a new account.

Add constants beside the others:

```ts
const PROTEIN_MAX = 400;
const WEIGHTS_MAX = 14;
```

At the end of `validateGoals`, before `return null`:

```ts
  const pMin = g.protein_min_g ?? null;
  const pMax = g.protein_max_g ?? null;
  if ((pMin === null) !== (pMax === null)) {
    return 'Set both ends of the protein range, or neither';
  }
  if (pMin !== null) {
    for (const v of [pMin, pMax]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Protein must be a number';
      if (!Number.isInteger(v)) return 'Protein must be a whole number of grams';
      if (v < 1 || v > PROTEIN_MAX) return `Protein must be between 1 and ${PROTEIN_MAX} g`;
    }
    if ((pMin as number) > (pMax as number)) return 'Protein minimum must not exceed the maximum';
  }

  const weights = g.weights_per_week ?? null;
  if (weights !== null) {
    if (typeof weights !== 'number' || !Number.isFinite(weights)) {
      return 'Weights sessions must be a number';
    }
    if (!Number.isInteger(weights)) return 'Weights sessions must be a whole number';
    if (weights < 0 || weights > WEIGHTS_MAX) {
      return `Weights sessions must be between 0 and ${WEIGHTS_MAX} a week`;
    }
  }
```

(`?? null` means an absent field validates as null. The route in Task 3 fills absent fields from the current period *before* validating, so this only matters for direct callers.)

- [ ] **Step 5: Run — expect PASS** for this file. The full suite will have type errors in other tests that build `GoalPeriod` literals; Task 3 fixes them. Do **not** commit yet if `npm run check` fails — continue to Task 3 and commit both together, or make the three fields temporarily optional. Preferred: go straight on to Task 3 and commit at its end.

---

### Task 3: Migration 009, store, goals route, `/auth/me`

**Files:**
- Create: `server/src/migrations/009_protein_weights.sql`
- Modify: `server/src/store.ts:669-699`, `server/src/routes/settings.ts:30-66`, `server/src/routes/auth.ts:20-35`
- Test: `server/src/__tests__/settings-route.test.ts`, `server/src/__tests__/db.test.ts`; fix literals in `summary.test.ts:398-445`, `trends-route.test.ts:274-290`

**Interfaces:**
- Consumes: `Goals`, `GoalPeriod`, `validateGoals` from Task 2.
- Produces: `listGoalPeriods` returns the three new fields; `putGoalPeriod` writes them. `GET /auth/me` and `POST /auth/login` return `goals` with the three fields. `PUT /settings/goals` accepts them, keeping absent ones. Columns `users.track_macros`, `users.track_protein` exist (used in Task 4).

- [ ] **Step 1: Write the migration** `server/src/migrations/009_protein_weights.sql`:

```sql
-- Targets from the plan as revised in September 2026: a daily protein range in
-- grams and weights sessions per week.
--
-- Null for every existing period, deliberately. Filling in 90-130 and 2 would re-judge
-- every day since August against goals adopted in late September, which is what
-- effective-dating exists to prevent. The targets are set on Settings, from today.
ALTER TABLE goal_periods ADD COLUMN protein_min_g    INTEGER;
ALTER TABLE goal_periods ADD COLUMN protein_max_g    INTEGER;
ALTER TABLE goal_periods ADD COLUMN weights_per_week INTEGER;

-- Two nested toggles under Diet: Macros, and Protein target under that. Stored flat —
-- nesting is how the Settings screen draws them, not something the server knows.
-- Both on, so nothing disappears from anyone's day on deploy.
ALTER TABLE users ADD COLUMN track_macros  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_protein INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Write the failing tests.** In `db.test.ts`, alongside the existing `toContain('001_init.sql')`, add `expect(versions).toContain('009_protein_weights.sql');`.

In `settings-route.test.ts`, add inside `describe('PUT /settings/goals', ...)`:

```ts
  it('stores a protein range and a weights target, and /auth/me returns them', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: {
        ...GOALS,
        protein_min_g: 90,
        protein_max_g: 130,
        weights_per_week: 2,
        scope: 'from_today',
      },
    });
    expect(res.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().goals).toMatchObject({
      protein_min_g: 90,
      protein_max_g: 130,
      weights_per_week: 2,
    });
    await app.close();
  });

  it('starts an account with no protein or weights target', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().goals).toMatchObject({
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
    });
    await app.close();
  });

  it('keeps targets a body leaves out, so an older form cannot erase them', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');
    const put = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: '/api/settings/goals', headers: { cookie }, payload });

    await put({ ...GOALS, protein_min_g: 90, protein_max_g: 130, weights_per_week: 2, scope: 'from_today' });
    // The four-field body a phone on the cached old shell would still send.
    const res = await put({ ...GOALS, kcal_budget: 2300, scope: 'from_today' });

    expect(res.json().goals).toMatchObject({
      kcal_budget: 2300,
      protein_min_g: 90,
      protein_max_g: 130,
      weights_per_week: 2,
    });
    await app.close();
  });

  it('clears a target sent as null', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');
    const put = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: '/api/settings/goals', headers: { cookie }, payload });

    await put({ ...GOALS, protein_min_g: 90, protein_max_g: 130, scope: 'from_today' });
    const res = await put({ ...GOALS, protein_min_g: null, protein_max_g: null, scope: 'from_today' });

    expect(res.json().goals).toMatchObject({ protein_min_g: null, protein_max_g: null });
    await app.close();
  });

  it('rejects half a protein range', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, protein_min_g: 90, protein_max_g: null, scope: 'from_today' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Set both ends of the protein range, or neither');
    await app.close();
  });

  it('keeps a past period at no target when a target is set from today', async () => {
    const db = testDb();
    const app = testApp(db);
    const { userId, cookie } = await loginAs(app, db, 'van');
    withHistory(db, userId);

    await app.inject({
      method: 'PUT',
      url: '/api/settings/goals',
      headers: { cookie },
      payload: { ...GOALS, protein_min_g: 90, protein_max_g: 130, scope: 'from_today' },
    });

    const periods = listGoalPeriods(db, userId);
    expect(periods[0]).toMatchObject({ effective_from: '2020-01-01', protein_min_g: null });
    expect(periods[1]).toMatchObject({ effective_from: today(), protein_min_g: 90 });
    await app.close();
  });
```

- [ ] **Step 3: Fix the other literals.** In `summary.test.ts` (three `putGoalPeriod` calls near lines 398–445) and `trends-route.test.ts` (two near lines 274–290), add to each object:

```ts
      protein_min_g: null,
      protein_max_g: null,
      weights_per_week: null,
```

- [ ] **Step 4: Run — expect FAIL** (`npm test --prefix server`): SQL has no such columns / goals lack the fields.

- [ ] **Step 5: Implement the store.** In `store.ts`:

```ts
export function listGoalPeriods(db: Db, userId: number): GoalPeriod[] {
  return db
    .prepare(
      `SELECT effective_from, kcal_budget, burn_target, window_start, window_end,
              protein_min_g, protein_max_g, weights_per_week
       FROM goal_periods WHERE user_id = ? ORDER BY effective_from`,
    )
    .all(userId) as GoalPeriod[];
}

export function putGoalPeriod(db: Db, userId: number, period: GoalPeriod): void {
  db.prepare(
    `INSERT INTO goal_periods
       (user_id, effective_from, kcal_budget, burn_target, window_start, window_end,
        protein_min_g, protein_max_g, weights_per_week)
     VALUES (@user_id, @effective_from, @kcal_budget, @burn_target, @window_start, @window_end,
             @protein_min_g, @protein_max_g, @weights_per_week)
     ON CONFLICT(user_id, effective_from) DO UPDATE SET
       kcal_budget      = excluded.kcal_budget,
       burn_target      = excluded.burn_target,
       window_start     = excluded.window_start,
       window_end       = excluded.window_end,
       protein_min_g    = excluded.protein_min_g,
       protein_max_g    = excluded.protein_max_g,
       weights_per_week = excluded.weights_per_week`,
  ).run({ user_id: userId, ...period });
}
```

- [ ] **Step 6: Implement the route.** In `routes/settings.ts`, replace the body of the `PUT /settings/goals` handler from `const { scope, ...goals }` through `return { goals: saved };` with:

```ts
      const user = request.user!;
      const { scope, ...body } = request.body ?? ({} as GoalsBody);

      if (!isScope(scope)) {
        return reply.code(400).send({ error: `scope must be one of ${SCOPES.join(', ')}` });
      }

      const today = localDay(Date.now(), user.timezone);
      const current = goalsForDay(listGoalPeriods(opts.db, user.id), today);

      // A target the body does not mention keeps its current value; one sent as null is
      // cleared. A phone still on the cached four-field form would otherwise erase both
      // targets the first time it saved a budget.
      const keep = <K extends keyof Goals>(key: K): Goals[K] =>
        key in body ? (body as Goals)[key] : current[key];

      const goals = {
        ...body,
        protein_min_g: keep('protein_min_g'),
        protein_max_g: keep('protein_max_g'),
        weights_per_week: keep('weights_per_week'),
      };

      const problem = validateGoals(goals);
      if (problem) return reply.code(400).send({ error: problem });

      const effective_from = scope === 'from_today' ? today : current.effective_from;

      // Field by field rather than spread. `goals` is whatever survived the rest
      // destructuring of the request body, and better-sqlite3 throws on a named
      // parameter its statement does not use — a stray key in the JSON would be a
      // 500 rather than the 400 it deserves.
      const saved: Goals = {
        kcal_budget: goals.kcal_budget,
        burn_target: goals.burn_target,
        window_start: goals.window_start,
        window_end: goals.window_end,
        protein_min_g: goals.protein_min_g,
        protein_max_g: goals.protein_max_g,
        weights_per_week: goals.weights_per_week,
      };

      putGoalPeriod(opts.db, user.id, { effective_from, ...saved });

      return { goals: saved };
```

Change `type GoalsBody = Goals & { scope?: string };` to `type GoalsBody = Partial<Goals> & { scope?: string };`.

- [ ] **Step 7: `/auth/me`.** In `routes/auth.ts` `currentGoals`, add the three fields to the returned object:

```ts
    protein_min_g: period.protein_min_g,
    protein_max_g: period.protein_max_g,
    weights_per_week: period.weights_per_week,
```

- [ ] **Step 8: Run — expect PASS.** `npm run check`.

- [ ] **Step 9: Commit** Tasks 2+3: `Store a protein range and a weights target on each goal period`.

---

### Task 4: Feature keys `macros` and `protein`, partial update

**Files:**
- Modify: `server/src/domain/features.ts`, `server/src/routes/settings.ts:68-86`, `server/src/store.ts:701` (comment only), `server/src/auth.ts:24` (comment only)
- Test: `server/src/__tests__/settings-route.test.ts:316-425`

**Interfaces:**
- Consumes: columns `track_macros`, `track_protein` from Task 3.
- Produces: `Features` has `macros` and `protein`. `PUT /settings/features` merges: absent keys keep stored values; returns the full set.

- [ ] **Step 1: Update tests.** In `settings-route.test.ts`:

```ts
const ALL_ON = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
  macros: true,
  protein: true,
};
```

Replace the test `'rejects a body missing a feature rather than guessing at it'` with:

```ts
  it('keeps a feature the body leaves out, so an older app cannot reset it', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');
    const put = (payload: Record<string, boolean>) =>
      app.inject({ method: 'PUT', url: '/api/settings/features', headers: { cookie }, payload });

    await put({ ...ALL_ON, protein: false });
    // The five keys a phone on the cached old shell knows about.
    const res = await put({ food: true, exercise: false, sleep: true, weight: true, goals: true });

    expect(res.statusCode).toBe(200);
    expect(res.json().features).toEqual({ ...ALL_ON, exercise: false, protein: false });
    await app.close();
  });

  it('rejects a feature that is not true or false', async () => {
    const db = testDb();
    const app = testApp(db);
    const { cookie } = await loginAs(app, db, 'van');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/features',
      headers: { cookie },
      payload: { macros: 'yes' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('macros must be true or false');
    await app.close();
  });
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `domain/features.ts`:

```ts
export const FEATURE_KEYS = [
  'food',
  'exercise',
  'sleep',
  'weight',
  'goals',
  'macros',
  'protein',
] as const;

export const FEATURE_COLUMNS: Record<FeatureKey, string> = {
  food: 'track_food',
  exercise: 'track_exercise',
  sleep: 'track_sleep',
  weight: 'track_weight',
  goals: 'track_goals',
  macros: 'track_macros',
  protein: 'track_protein',
};
```

Add to the file's doc comment: `macros` and `protein` are drawn nested under `food` on the web; the server stores flat booleans and knows nothing of nesting.

`routes/settings.ts`, the features handler:

```ts
      const body = request.body ?? {};

      // Built key by key from FEATURE_KEYS rather than taken wholesale, so an
      // unrecognised key simply never arrives. A key the body leaves out keeps what is
      // stored: a phone still running a cached older shell knows fewer toggles, and
      // would otherwise switch every newer one off each time it saved.
      const features = { ...request.user!.features };
      for (const key of FEATURE_KEYS) {
        if (!(key in body)) continue;
        if (typeof body[key] !== 'boolean') {
          return reply.code(400).send({ error: `${key} must be true or false` });
        }
        features[key] = body[key] as boolean;
      }

      setFeatures(opts.db, request.user!.id, features);
      return { features };
```

Change "five" to "all" in the `setFeatures` comment (`store.ts`) and "The five feature flags" to "The feature flags" in `auth.ts`.

- [ ] **Step 4: Run — expect PASS.** `npm run check`.

- [ ] **Step 5: Commit** — `Add Macros and Protein target toggles, and let a save leave toggles out`.

---

### Task 5: Summary carries the day's protein and its range

**Files:**
- Modify: `server/src/routes/summary.ts:45-60`
- Test: `server/src/__tests__/summary.test.ts`

**Interfaces:**
- Produces: `GET /summary/:date` → `food.protein: { grams: number; min: number | null; max: number | null; floor: boolean }`. `grams` is `Math.round(totals.protein_g)`; `floor` is true when any entry that day has no macros on record.

- [ ] **Step 1: Write the failing test** — read the top of `summary.test.ts` to reuse its existing helpers for logging food and quick entries (it already logs `USDA_BANANA` and posts quick entries; follow those calls exactly). Add:

```ts
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

    const before = await app.inject({ method: 'GET', url: '/api/summary/2026-09-01', headers: { cookie } });
    const after = await app.inject({ method: 'GET', url: '/api/summary/2026-09-25', headers: { cookie } });

    expect(before.json().food.protein).toEqual({ grams: 0, min: null, max: null, floor: false });
    expect(after.json().food.protein).toEqual({ grams: 0, min: 90, max: 130, floor: false });
    await app.close();
  });
```

Then a second `it` in the same `describe`: log a banana (with macros) and a quick calories-only entry on one day, using the same request shapes the existing quick-entry tests in `summary.test.ts` / `quick-food.test.ts` use, and assert `food.protein.floor === true` and `food.protein.grams === Math.round(<the banana's protein_g>)`. A third: only the banana → `floor === false`.

- [ ] **Step 2: Run — expect FAIL** (`food.protein` undefined).

- [ ] **Step 3: Implement** — in `summary.ts`, inside `food: { ... }` after `remaining`:

```ts
          // Grams against the range in force on this day. `floor` says the figure can
          // only be a lower bound: a calories-only entry carries no protein, and
          // nothing here guesses what it had.
          protein: {
            grams: Math.round(totals.protein_g),
            min: goals.protein_min_g,
            max: goals.protein_max_g,
            floor: foods.some((f) => f.macros_unknown),
          },
```

- [ ] **Step 4: Run — expect PASS.** `npm run check`.

- [ ] **Step 5: Commit** — `Report the day's protein against its range`.

---

### Task 6: Weekly weights sessions — pure domain

**Files:**
- Modify: `server/src/domain/trend.ts`
- Test: `server/src/__tests__/trend.test.ts`

**Interfaces:**
- Consumes: `addDays` from `domain/day.ts`.
- Produces:
  ```ts
  export function mondayOf(day: string): string;
  export type WeekState = 'met' | 'missed' | 'in_progress' | 'partial' | 'no_target';
  export interface WeekSessions {
    week_start: string;       // the Monday, YYYY-MM-DD (may be before range[0])
    count: number;            // distinct in-range days with a session
    target: number | null;    // target in force on week_start
    state: WeekState;
  }
  export function weeklySessions(
    range: string[],                              // consecutive days, oldest first, ends today
    sessionDays: Set<string>,
    targetFor: (day: string) => number | null,
    today: string,
  ): WeekSessions[];
  ```

State rules, in order: `target === null` → `no_target`; `count >= target` → `met`; week contains `today` → `in_progress`; `week_start < range[0]` → `partial`; else `missed`.

- [ ] **Step 1: Write the failing tests** — append to `trend.test.ts` (add `mondayOf`, `weeklySessions` to the import from `../domain/trend`, and `dayRange` from `../domain/day`):

```ts
describe('mondayOf', () => {
  it('finds the Monday of the week, Monday itself included', () => {
    expect(mondayOf('2026-09-21')).toBe('2026-09-21'); // Monday
    expect(mondayOf('2026-09-27')).toBe('2026-09-21'); // Sunday
    expect(mondayOf('2026-09-24')).toBe('2026-09-21'); // Thursday
  });

  it('crosses a month and a year', () => {
    expect(mondayOf('2026-10-01')).toBe('2026-09-28');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });
});

describe('weeklySessions', () => {
  // Mon 2026-09-07 .. Sun 2026-09-27: three whole weeks, today the final Sunday.
  const range = dayRange('2026-09-27', 21);
  const two = () => 2;

  it('counts one session per day, however many entries it had', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-08', '2026-09-10']), two, '2026-09-27');
    expect(weeks[0]).toEqual({ week_start: '2026-09-07', count: 2, target: 2, state: 'met' });
  });

  it('calls a finished week under target missed', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-15']), two, '2026-09-27');
    expect(weeks[1]).toEqual({ week_start: '2026-09-14', count: 1, target: 2, state: 'missed' });
  });

  it('never calls the current week missed', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-22']), two, '2026-09-24');
    expect(weeks[2].state).toBe('in_progress');
  });

  it('calls the current week met as soon as it is', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-22', '2026-09-23']), two, '2026-09-24');
    expect(weeks[2].state).toBe('met');
  });

  it('marks a week the range starts partway through as partial, counting only its days', () => {
    const midweek = dayRange('2026-09-27', 18); // starts Thu 2026-09-10
    const weeks = weeklySessions(midweek, new Set(['2026-09-08', '2026-09-11']), two, '2026-09-27');
    expect(weeks[0]).toEqual({ week_start: '2026-09-07', count: 1, target: 2, state: 'partial' });
    expect(weeks).toHaveLength(3);
  });

  it('judges each week by the target in force on its Monday', () => {
    const targetFor = (day: string) => (day >= '2026-09-21' ? 3 : 1);
    const days = new Set(['2026-09-08', '2026-09-22', '2026-09-23']);
    const weeks = weeklySessions(range, days, targetFor, '2026-09-27');
    expect(weeks.map((w) => [w.target, w.state])).toEqual([
      [1, 'met'],
      [1, 'missed'],
      [3, 'in_progress'],
    ]);
  });

  it('meets a zero target by doing nothing', () => {
    const weeks = weeklySessions(range, new Set(), () => 0, '2026-09-27');
    expect(weeks.every((w) => w.state === 'met')).toBe(true);
  });

  it('shows the count with no verdict where there is no target', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-08']), () => null, '2026-09-27');
    expect(weeks[0]).toEqual({ week_start: '2026-09-07', count: 1, target: null, state: 'no_target' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — append to `domain/trend.ts` (add `import { addDays } from './day';` at the top):

```ts
/** The Monday starting the Mon–Sun week a day falls in. */
export function mondayOf(day: string): string {
  // Noon UTC, so no timezone can move the calendar day under getUTCDay.
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export type WeekState = 'met' | 'missed' | 'in_progress' | 'partial' | 'no_target';

export interface WeekSessions {
  /** The Monday. Can fall before the range when the range starts midweek. */
  week_start: string;
  /** Days in range with a session. A day is one session however many entries it had. */
  count: number;
  target: number | null;
  state: WeekState;
}

/**
 * Sessions per Mon–Sun week over a range, each judged by the target in force on its
 * Monday.
 *
 * The current week is never a miss — there are days left in it. Nor is a week the
 * range starts partway through: its count covers only the days in view, so judging it
 * would call a met week missed for having been cut off by the chart.
 */
export function weeklySessions(
  range: string[],
  sessionDays: Set<string>,
  targetFor: (day: string) => number | null,
  today: string,
): WeekSessions[] {
  const weeks = new Map<string, number>();
  for (const day of range) {
    const monday = mondayOf(day);
    weeks.set(monday, (weeks.get(monday) ?? 0) + (sessionDays.has(day) ? 1 : 0));
  }

  return [...weeks].map(([week_start, count]) => {
    const target = targetFor(week_start);
    let state: WeekState;
    if (target === null) state = 'no_target';
    else if (count >= target) state = 'met';
    else if (addDays(week_start, 6) >= today) state = 'in_progress';
    else if (week_start < range[0]) state = 'partial';
    else state = 'missed';
    return { week_start, count, target, state };
  });
}
```

- [ ] **Step 4: Run — expect PASS.** `npm run check`.

- [ ] **Step 5: Commit** — `Count weights sessions per Monday-to-Sunday week`.

---

### Task 7: Trends route — protein per day, weights weeks

**Files:**
- Modify: `server/src/store.ts` (after `burnByDay`), `server/src/routes/trends.ts`
- Test: `server/src/__tests__/trends-route.test.ts`

**Interfaces:**
- Consumes: `weeklySessions` (Task 6), goal fields (Task 3).
- Produces: `GET /trends` adds
  - per row: `protein_min_g: number | null`, `protein_max_g: number | null`
  - top level: `weights_per_week: number | null` (today's), `weights_weeks: WeekSessions[]`
  - `summary.avg_protein_g: number | null` (over logged days), `summary.protein_days_with_target: number`, `summary.protein_days_in_range: number`
- Store: `weightsDays(db, userId, from, to): string[]`

- [ ] **Step 1: Write the failing tests** — in `trends-route.test.ts`, following the file's `beforeEach` setup and its `post`/`get` helpers:

```ts
  it('counts weights sessions per week, one per day', async () => {
    const d = daysAgo(1);
    await post('/api/log/exercise', { activity: 'weights', minutes: 40, date: d });
    await post('/api/log/exercise', { activity: 'weights', minutes: 20, date: d });
    await post('/api/log/exercise', { activity: 'running', minutes: 30, date: d });

    const res = await get('/api/trends?days=14');
    const total = res.json().weights_weeks.reduce((n: number, w: { count: number }) => n + w.count, 0);
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
    db.prepare('DELETE FROM goal_periods WHERE user_id = ? AND effective_from > ?').run(userId, '2020-01-01');

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

    // A banana has ~1.09 g protein per 100 g; 500 g is ~5 g — inside 1–400.
    await logOn(daysAgo(1), 12, 89, 500);
    await logOn(daysAgo(5), 12, 89, 500);

    const res = await get('/api/trends?days=7');
    const days = res.json().days;
    expect(days.find((r: { day: string }) => r.day === daysAgo(5)).protein_min_g).toBeNull();
    expect(days.find((r: { day: string }) => r.day === daysAgo(1)).protein_min_g).toBe(1);
    expect(res.json().summary.protein_days_with_target).toBe(1);
    expect(res.json().summary.protein_days_in_range).toBe(1);
    expect(res.json().summary.avg_protein_g).toBe(5);
  });

  it('does not count another account’s weights', async () => {
    const other = await loginAs(app, db, 'sam');
    await app.inject({
      method: 'POST',
      url: '/api/log/exercise',
      payload: { activity: 'weights', minutes: 40, date: daysAgo(1) },
      headers: { cookie: other.cookie },
    });

    const res = await get('/api/trends?days=14');
    const total = res.json().weights_weeks.reduce((n: number, w: { count: number }) => n + w.count, 0);
    expect(total).toBe(0);
  });
```

Check how `POST /log/exercise` expects its body (read `server/src/routes/log.ts`; Today posts `{ activity, minutes, date }`) and whether logging exercise requires a weight on record — if `estimateKcal` throws without one, first `put('/api/day/<date>', { weight_lb: 195 })` the way existing exercise tests do.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Store** — after `burnByDay` in `store.ts`:

```ts
/** The days in a range with at least one weights entry. A day is one session. */
export function weightsDays(db: Db, userId: number, from: string, to: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT local_day FROM exercise_log
         WHERE user_id = ? AND activity = 'weights' AND local_day BETWEEN ? AND ?
         ORDER BY local_day`,
      )
      .all(userId, from, to) as { local_day: string }[]
  ).map((r) => r.local_day);
}
```

- [ ] **Step 4: Route** — in `routes/trends.ts`:
  - import `weeklySessions` from `../domain/trend` and `weightsDays` from `../store`.
  - in each row, after `budget: goals.kcal_budget,`:
    ```ts
          protein_min_g: goals.protein_min_g,
          protein_max_g: goals.protein_max_g,
    ```
  - after `const current = goalsForDay(periods, today);`:
    ```ts
      // Only logged days with a target in force are judged — a day before the target
      // existed is not a miss, and neither is a day with nothing logged.
      const proteinJudged = loggedDays.filter((r) => r.protein_min_g !== null);
      const proteinInRange = proteinJudged.filter(
        (r) => r.protein_g! >= r.protein_min_g! && r.protein_g! <= r.protein_max_g!,
      );
    ```
  - in the response, after `burn_target`:
    ```ts
        weights_per_week: current.weights_per_week,
        weights_weeks: weeklySessions(
          range,
          new Set(weightsDays(opts.db, user.id, from, today)),
          (day) => goalsForDay(periods, day).weights_per_week,
          today,
        ),
    ```
  - in `summary`, after `avg_kcal`:
    ```ts
          avg_protein_g: average(loggedDays.map((r) => r.protein_g!)),
          protein_days_with_target: proteinJudged.length,
          protein_days_in_range: proteinInRange.length,
    ```

  Note: `weeklySessions` counts sessions only within `range`, and `weightsDays` is fetched over the same `from..today`, so a partial first week counts in-range days only.

  Note on "in range": the Today bar treats above-max as fine (never a warning), but the Trends count says "in range", so above max is *not* in range. This is deliberate — the headline says what it counts.

- [ ] **Step 5: Run — expect PASS.** `npm run check`.

- [ ] **Step 6: Commit** — `Chart protein against its range and weights against the weekly target`.

---

### Task 8: Web settings model — nested toggles

**Files:**
- Modify: `web/src/settings.ts`
- Test: `web/src/__tests__/settings.test.ts`; fix `all` literal in `web/src/__tests__/day-summaries.test.ts:8`

**Interfaces:**
- Produces:
  ```ts
  interface Settings { food; exercise; sleep; weight; goals; macros; protein }  // all boolean
  FEATURES: { key: keyof Settings; label: string; detail: string; parent?: keyof Settings }[]
  export function isOn(settings: Settings, key: keyof Settings): boolean;
  export function depth(key: keyof Settings): number;   // 0 top-level, 1 macros, 2 protein
  nothingTracked(settings)  // counts only features with no parent
  ```

- [ ] **Step 1: Write the failing tests.** In `settings.test.ts`, extend `ALL_ON` with `macros: true, protein: true`, add `isOn`/`depth` to the import, then append:

```ts
describe('isOn', () => {
  it('is a top-level feature’s own value', () => {
    expect(isOn({ ...ALL_ON, sleep: false }, 'sleep')).toBe(false);
    expect(isOn(ALL_ON, 'sleep')).toBe(true);
  });

  it('is off when any ancestor is off, whatever the child says', () => {
    expect(isOn({ ...ALL_ON, food: false }, 'macros')).toBe(false);
    expect(isOn({ ...ALL_ON, food: false }, 'protein')).toBe(false);
    expect(isOn({ ...ALL_ON, macros: false }, 'protein')).toBe(false);
  });

  it('comes back as it was when the ancestor comes back', () => {
    const s = { ...ALL_ON, protein: false };
    expect(isOn({ ...s, food: false }, 'protein')).toBe(false);
    expect(isOn(s, 'protein')).toBe(false);
    expect(isOn(s, 'macros')).toBe(true);
  });
});

describe('FEATURES nesting', () => {
  it('lists Macros under Diet and Protein target under Macros, each right after its parent', () => {
    const keys = FEATURES.map((f) => f.key);
    expect(FEATURES.find((f) => f.key === 'macros')?.parent).toBe('food');
    expect(FEATURES.find((f) => f.key === 'protein')?.parent).toBe('macros');
    expect(keys.indexOf('macros')).toBe(keys.indexOf('food') + 1);
    expect(keys.indexOf('protein')).toBe(keys.indexOf('macros') + 1);
    expect(depth('food')).toBe(0);
    expect(depth('protein')).toBe(2);
  });
});
```

And in `describe('nothingTracked', ...)`:

```ts
  it('ignores sub-toggles: Macros on under Diet off draws nothing', () => {
    const onlyChildren = { ...ALL_OFF, macros: true, protein: true };
    expect(nothingTracked(onlyChildren)).toBe(true);
  });
```

In `day-summaries.test.ts`, change `all` to include `macros: true, protein: true`.

- [ ] **Step 2: Run — expect FAIL** (`cd web && npx vitest run src/__tests__/settings.test.ts`).

- [ ] **Step 3: Implement** in `web/src/settings.ts`:
  - `Settings` gains:
    ```ts
    /** The carb/protein/fat split. Drawn under Diet; off with it. */
    macros: boolean;
    /** The protein bar and chart against the range set under Goals. Under Macros. */
    protein: boolean;
    ```
  - `DEFAULT_SETTINGS` gains `macros: true, protein: true`.
  - `FEATURES`: add `parent?: keyof Settings` to the element type; change Diet's detail to `'Calories, what you ate, and the eating window.'`; insert right after the `food` entry:
    ```ts
      {
        key: 'macros',
        label: 'Macros',
        detail: 'The split of carbs, protein and fat.',
        parent: 'food',
      },
      {
        key: 'protein',
        label: 'Protein target',
        // Replaced on screen by the range itself, or by how to set one.
        detail: 'Grams a day against a range.',
        parent: 'macros',
      },
    ```
  - add:
    ```ts
    const PARENT = new Map(FEATURES.map((f) => [f.key, f.parent]));

    /**
     * Whether a feature is being drawn: its own switch and every switch above it.
     *
     * Each is stored on its own, so turning Diet off and on again brings Macros and
     * Protein back as they were rather than resetting them. Every screen asks this
     * rather than reading a flag, so a nested toggle cannot be half-respected.
     */
    export function isOn(settings: Settings, key: keyof Settings): boolean {
      for (let k: keyof Settings | undefined = key; k; k = PARENT.get(k)) {
        if (!settings[k]) return false;
      }
      return true;
    }

    /** How far a toggle is indented under its parents. */
    export function depth(key: keyof Settings): number {
      let n = 0;
      for (let k = PARENT.get(key); k; k = PARENT.get(k)) n++;
      return n;
    }
    ```
  - `nothingTracked`: `return FEATURES.filter((f) => !f.parent).every((f) => !settings[f.key]);` and add to its comment that sub-toggles do not count — a child can draw nothing while its parent is off.

- [ ] **Step 4: Run — expect PASS.** `npm run check` (the web `tsc` catches every other `Settings` literal; fix any it names the same way).

- [ ] **Step 5: Commit** — `Nest Macros and Protein target under Diet`.

---

### Task 9: Settings screen draws the tree

**Files:**
- Modify: `web/src/screens/Settings.tsx:38-56`, `web/src/styles.css` (settings toggles section, ~line 1605)

**Interfaces:**
- Consumes: `FEATURES`, `isOn`, `depth` (Task 8); `goals.protein_min_g/max_g` (Task 10 adds them to the web `Goals` type — if doing Task 9 first, add the two fields to `web/src/types.ts` `Goals` now as `number | null`).

- [ ] **Step 1: Implement.** Replace the `FEATURES.map(...)` block in `Settings.tsx`:

```tsx
          {FEATURES.map((f) => {
            // A child whose parent is off keeps showing its own stored position, dimmed
            // and inert: it will be exactly that again when the parent comes back.
            const inert = f.parent !== undefined && !isOn(settings, f.parent);
            const detail =
              f.key === 'protein'
                ? goals.protein_min_g !== null
                  ? `${goals.protein_min_g}–${goals.protein_max_g} g a day.`
                  : 'No range set — add one under Goals below.'
                : f.detail;

            return (
              <label
                className={`toggle toggle-depth-${depth(f.key)}${inert ? ' toggle-inert' : ''}`}
                key={f.key}
              >
                <span className="toggle-text">
                  <span className="toggle-label">{f.label}</span>
                  <span className="toggle-detail">{detail}</span>
                </span>
                <input
                  type="checkbox"
                  className="toggle-input"
                  checked={settings[f.key]}
                  disabled={inert}
                  onChange={(e) => onChange({ ...settings, [f.key]: e.target.checked })}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-knob" />
                </span>
              </label>
            );
          })}
```

Import `isOn, depth` alongside `FEATURES`.

- [ ] **Step 2: CSS.** Read the existing `.toggle` rules (~line 1605–1680) first; then add after them:

```css
/* Sub-toggles sit under their parent, indented, with no rule between them and it —
   they are part of the parent's row group, not peers. */
.toggle-depth-1 {
  padding-left: 18px;
}

.toggle-depth-2 {
  padding-left: 36px;
}

.toggle.toggle-depth-1,
.toggle.toggle-depth-2 {
  border-top: none;
}

/* Parent off: the child still shows where it will be when the parent returns. */
.toggle-inert {
  opacity: 0.45;
}
```

If `.toggle + .toggle` draws the separator with something other than `border-top`, override that property instead — match what is there.

- [ ] **Step 3: Look at it.** With `./dev.sh` running, open http://localhost:5174 → Settings. Check: indentation reads as a tree at 390px wide; turning Diet off dims Macros and Protein target and they cannot be tapped; turning it back on restores their previous positions; the protein detail line reads "No range set — add one under Goals below."

- [ ] **Step 4:** `npm run check`. **Commit** — `Draw the Track toggles as a tree`.

---

### Task 10: GoalsForm — protein range and weights rows

**Files:**
- Modify: `web/src/types.ts:3-9`, `web/src/components/GoalsForm.tsx`

**Interfaces:**
- Consumes: server `PUT /settings/goals` from Task 3; `isOn` from Task 8.
- Produces: web `Goals` has `protein_min_g`, `protein_max_g`, `weights_per_week` as `number | null`.

- [ ] **Step 1: Types.** In `web/src/types.ts` `Goals`, add:

```ts
  /** Grams a day. Both null is no target. */
  protein_min_g: number | null;
  protein_max_g: number | null;
  /** Days with a weights session per Mon–Sun week. Null is no target. */
  weights_per_week: number | null;
```

- [ ] **Step 2: Form.** In `GoalsForm.tsx`:
  - import `isOn` from `../settings`.
  - helpers at module level:
    ```ts
    /** An empty box is no target; anything else is sent as typed and judged by the server. */
    const toNullable = (s: string): number | null => (s.trim() === '' ? null : Number(s));
    const fromNullable = (n: number | null): string => (n === null ? '' : String(n));
    ```
  - state:
    ```ts
    const [pMin, setPMin] = useState(fromNullable(goals.protein_min_g));
    const [pMax, setPMax] = useState(fromNullable(goals.protein_max_g));
    const [weights, setWeights] = useState(fromNullable(goals.weights_per_week));
    ```
  - `edited` gains `protein_min_g: toNullable(pMin), protein_max_g: toNullable(pMax), weights_per_week: toNullable(weights)`.
  - `changed` gains the three `!==` comparisons.
  - `reset()` gains the three setters with `fromNullable(goals.…)`.
  - Update the component doc comment: "The three numbers" → "The numbers"; add a sentence that an empty protein or weights box means no target.
  - After the Burn target `<label>`, add:
    ```tsx
        <div className={`${row(isOn(tracked, 'protein'))} field-row-stack`}>
          <span className="field-label">Protein</span>
          <span className="field-input">
            <input
              type="number"
              inputMode="numeric"
              value={pMin}
              placeholder="—"
              aria-label="Protein minimum"
              onChange={(e) => setPMin(e.target.value)}
            />
            <span className="field-unit">to</span>
            <input
              type="number"
              inputMode="numeric"
              value={pMax}
              placeholder="—"
              aria-label="Protein maximum"
              onChange={(e) => setPMax(e.target.value)}
            />
            <span className="field-unit">g</span>
          </span>
        </div>

        <label className={row(tracked.exercise)}>
          <span className="field-label">Weights</span>
          <span className="field-input">
            <input
              type="number"
              inputMode="numeric"
              value={weights}
              placeholder="—"
              onChange={(e) => setWeights(e.target.value)}
            />
            <span className="field-unit">a week</span>
          </span>
        </label>
    ```
  (`row(tracked.food)` above stays — `food` is top-level so `isOn` and the flag agree.)

- [ ] **Step 3: Look at it.** Settings at 390×844: the protein row fits on one line or wraps as a unit; no horizontal scroll (`document.documentElement.scrollWidth <= 390`). Set 90–130 and 2, save "From today onward", reload — values persist. Clear both protein boxes, save — reload shows empty and the Track detail line says "No range set". Enter only a minimum — the error "Set both ends of the protein range, or neither" appears and the edits stay.

- [ ] **Step 4:** `npm run check`. **Commit** — `Set a protein range and a weekly weights target on Settings`.

---

### Task 11: Today — the protein bar

**Files:**
- Create: `web/src/components/ProteinBar.tsx`
- Create: `web/src/__tests__/protein-bar.test.ts`
- Modify: `web/src/types.ts` (`DaySummary.food`), `web/src/screens/Today.tsx:294-315`, `web/src/styles.css` (after the macros section)
- Test: `web/src/__tests__/day-summaries.test.ts`

**Interfaces:**
- Consumes: `food.protein` from Task 5; `isOn` from Task 8.
- Produces:
  ```ts
  export interface ProteinBarState {
    label: string;                                  // "72 g" or "72+ g"
    target: string | null;                          // "90–130 g" or null
    fill: number;                                   // percent 0–100
    band: { left: number; width: number } | null;   // percent
    inRange: boolean;                               // grams >= min (above max stays true)
  }
  export function proteinBar(p: { grams: number; min: number | null; max: number | null; floor: boolean }): ProteinBarState;
  export function ProteinBar(props: { protein: DaySummary['food']['protein'] }): JSX.Element;
  export function macrosWindowSummary(
    win: { first: string | null; last: string | null },
    protein: { grams: number; floor: boolean } | null,   // null when protein is not drawn
  ): string | undefined;   // exported from Today.tsx
  ```

- [ ] **Step 1: Types.** In `web/src/types.ts` `DaySummary.food`, after `remaining`:

```ts
    /** The day's protein against the range in force that day. */
    protein: { grams: number; min: number | null; max: number | null; floor: boolean };
```

- [ ] **Step 2: Write the failing tests** — `web/src/__tests__/protein-bar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { proteinBar } from '../components/ProteinBar';

const day = (grams: number, floor = false) => ({ grams, min: 90, max: 130, floor });

describe('proteinBar', () => {
  it('scales so the top of the range sits at 85% of the width', () => {
    const s = proteinBar(day(0));
    expect(s.band!.left).toBeCloseTo((90 / 130) * 85);
    expect(s.band!.left + s.band!.width).toBeCloseTo(85);
  });

  it('is not in range below the minimum', () => {
    const s = proteinBar(day(72));
    expect(s.inRange).toBe(false);
    expect(s.fill).toBeCloseTo((72 / 130) * 85);
    expect(s.label).toBe('72 g');
    expect(s.target).toBe('90–130 g');
  });

  it('is in range from the minimum, inclusive', () => {
    expect(proteinBar(day(90)).inRange).toBe(true);
    expect(proteinBar(day(130)).inRange).toBe(true);
  });

  it('stays in range above the maximum — too much protein is not what this watches', () => {
    const s = proteinBar(day(150));
    expect(s.inRange).toBe(true);
  });

  it('fills to the edge and no further', () => {
    expect(proteinBar(day(400)).fill).toBe(100);
  });

  it('says the figure is a floor when some calories have no macros', () => {
    expect(proteinBar(day(72, true)).label).toBe('72+ g');
  });

  it('draws no band and makes no judgement without a range', () => {
    const s = proteinBar({ grams: 72, min: null, max: null, floor: false });
    expect(s.band).toBeNull();
    expect(s.target).toBeNull();
    expect(s.inRange).toBe(false);
  });
});
```

Append to `day-summaries.test.ts` (import `macrosWindowSummary` from `../screens/Today`):

```ts
describe('macrosWindowSummary', () => {
  it('carries protein and the window', () => {
    expect(macrosWindowSummary({ first: '9:14', last: '6:40' }, { grams: 72, floor: false })).toBe(
      '72 g protein · 9:14–6:40',
    );
  });

  it('marks a floor', () => {
    expect(macrosWindowSummary({ first: null, last: null }, { grams: 72, floor: true })).toBe(
      '72+ g protein',
    );
  });

  it('drops protein when it is not being drawn, and says nothing for an empty day', () => {
    expect(macrosWindowSummary({ first: '9:14', last: '6:40' }, null)).toBe('9:14–6:40');
    expect(macrosWindowSummary({ first: null, last: null }, null)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** `web/src/components/ProteinBar.tsx`:

```tsx
import type { DaySummary } from '../types';

/** Where the top of the range sits, as a share of the bar — room to show going past it. */
const MAX_AT = 85;

export interface ProteinBarState {
  label: string;
  target: string | null;
  fill: number;
  band: { left: number; width: number } | null;
  inRange: boolean;
}

/**
 * The day's protein as a bar against its range. Pure, so every state is tested
 * without rendering.
 *
 * Above the maximum stays green and keeps filling: the September 2026 plan is about
 * getting enough, and too much protein is not the risk it tracks, so the bar never
 * warns. Zero-based, like every bar in this app.
 */
export function proteinBar(p: {
  grams: number;
  min: number | null;
  max: number | null;
  floor: boolean;
}): ProteinBarState {
  const label = `${p.grams}${p.floor ? '+' : ''} g`;
  if (p.min === null || p.max === null) {
    return { label, target: null, fill: 0, band: null, inRange: false };
  }

  const pct = (g: number) => Math.min(100, (g / p.max!) * MAX_AT);
  return {
    label,
    target: `${p.min}–${p.max} g`,
    fill: pct(p.grams),
    band: { left: pct(p.min), width: pct(p.max) - pct(p.min) },
    inRange: p.grams >= p.min,
  };
}

export function ProteinBar({ protein }: { protein: DaySummary['food']['protein'] }) {
  const s = proteinBar(protein);

  // No range: the figure alone, rather than a bar measured against nothing.
  if (!s.band) {
    return (
      <div className="protein">
        <div className="protein-head">
          <span className="protein-title">Protein</span>
          <span className="protein-value">{s.label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="protein">
      <div className="protein-head">
        <span className="protein-title">Protein</span>
        <span className="protein-value">
          {s.label} <span className="faint">of {s.target}</span>
        </span>
      </div>
      <div
        className="protein-bar"
        role="img"
        aria-label={`Protein ${s.label} of ${s.target}${s.inRange ? ', in range' : ''}`}
      >
        <div className="protein-band" style={{ left: `${s.band.left}%`, width: `${s.band.width}%` }} />
        <div
          className={s.inRange ? 'protein-fill protein-fill-in' : 'protein-fill'}
          style={{ width: `${s.fill}%` }}
        />
      </div>
    </div>
  );
}
```

CSS, after the macros section in `styles.css`:

```css
/* ---------- protein ---------- */

/* Not the protein yellow — this is about hitting a target, not which macro it is —
   and not amber, which is spoken for. Neutral until the range is reached, then the
   accent green that means "met" everywhere else. */
.protein {
  margin-top: 16px;
}

.protein-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 7px;
}

.protein-title {
  color: var(--text-faint);
}

.protein-value {
  font-variant-numeric: tabular-nums;
}

.protein-bar {
  position: relative;
  height: 9px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--surface-2);
}

.protein-band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--accent-dim);
}

.protein-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 999px;
  background: var(--text-faint);
  transition: width 0.3s ease;
}

.protein-fill-in {
  background: var(--accent);
}
```

- [ ] **Step 5: Today.** In `Today.tsx`:
  - import `ProteinBar` and `isOn`.
  - add, near `morningSummary`:
    ```ts
    /** What the macros-and-window card keeps in its heading when folded. */
    export function macrosWindowSummary(
      win: { first: string | null; last: string | null },
      protein: { grams: number; floor: boolean } | null,
    ): string | undefined {
      const parts: string[] = [];
      if (protein) parts.push(`${protein.grams}${protein.floor ? '+' : ''} g protein`);
      if (win.first !== null && win.last !== null) parts.push(`${win.first}–${win.last}`);
      return parts.length ? parts.join(' · ') : undefined;
    }
    ```
  - replace the macros-window card:
    ```tsx
        {settings.food && (
          <CollapsibleCard
            id="macros-window"
            title={isOn(settings, 'macros') ? 'Eating macros and window' : 'Eating window'}
            summary={macrosWindowSummary(
              win,
              isOn(settings, 'protein') ? food.protein : null,
            )}
          >
            {isOn(settings, 'macros') && (
              <MacroBar
                protein_g={food.totals.protein_g}
                fat_g={food.totals.fat_g}
                carb_g={food.totals.carb_g}
                unknownKcal={food.macro_unknown_kcal}
                totalKcal={food.totals.kcal}
              />
            )}
            {isOn(settings, 'protein') && <ProteinBar protein={food.protein} />}
            <div className="card-split">
              <WindowBar window={win} />
            </div>
          </CollapsibleCard>
        )}
    ```
    Update the comment above the card: collapsed, the heading keeps protein and the window's two ends.
  - `food` here must come from `summary` for `shown` (it already does — do not read `date`).

- [ ] **Step 6: Run — expect PASS.** `npm run check`.

- [ ] **Step 7: Look at it** at 390×844 dark and light: below range (grey fill, green band visible), in range (green fill), above (green fill past the band), no range set (text only), a day with a quick entry ("72+ g"), Macros off (card retitled, no bars), Protein off (split bar but no protein bar). Run the CVD validator from the `dataviz` skill on `--accent` against `--carb` and `--accent-dim` against `--surface-2` in both themes; record the numbers in the CSS comment. If separation fails, adjust `.protein-band` only.

- [ ] **Step 8: Commit** — `Show the day's protein against its range on Today`.

---

### Task 12: Trends — protein chart and weights strip

**Files:**
- Modify: `web/src/components/charts.tsx`, `web/src/screens/Trends.tsx`, `web/src/styles.css`
- Test: `web/src/__tests__/charts.test.ts`

**Interfaces:**
- Consumes: Task 7's response fields; `isOn`.
- Produces:
  ```ts
  export function ProteinChart(props: {
    points: (Series & { min: number | null; max: number | null })[];
  }): JSX.Element;
  export function weekCellText(w: { count: number; state: WeekState }): string;
  export function WeeksStrip(props: { weeks: { week_start: string; count: number; target: number | null; state: WeekState }[] }): JSX.Element;
  type WeekState = 'met' | 'missed' | 'in_progress' | 'partial' | 'no_target';  // declared in charts.tsx
  ```

- [ ] **Step 1: Write the failing test** — append to `charts.test.ts` (import `weekCellText`):

```ts
describe('weekCellText', () => {
  it('ticks a met week', () => {
    expect(weekCellText({ count: 2, state: 'met' })).toBe('2 ✓');
  });

  it('marks the current week as still going, never as a miss', () => {
    expect(weekCellText({ count: 1, state: 'in_progress' })).toBe('1…');
  });

  it('shows a bare count otherwise', () => {
    expect(weekCellText({ count: 1, state: 'missed' })).toBe('1');
    expect(weekCellText({ count: 0, state: 'partial' })).toBe('0');
    expect(weekCellText({ count: 3, state: 'no_target' })).toBe('3');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** in `charts.tsx`, after `CalorieChart`:

```tsx
/**
 * Daily protein as zero-based bars over the band each day was aiming at. The band
 * rides on each point, like the calorie budget, because a range can start partway
 * through the chart — days before it draw bars with nothing behind them.
 */
export function ProteinChart({
  points,
}: {
  points: (Series & { min: number | null; max: number | null })[];
}) {
  if (points.every((p) => p.value === null)) {
    return <div className="empty tiny">Nothing logged in this range yet.</div>;
  }

  const ends = points.flatMap((p) => (p.max === null ? [] : [p.max]));

  return (
    <ChartFrame
      points={points}
      scale={{ fromZero: true, include: ends }}
      tooltip={(i) => (
        <>
          <div className="chart-tip-day">{longDay(points[i].day)}</div>
          <div className="chart-tip-value">
            {points[i].value === null ? 'nothing logged' : `${points[i].value} g`}
            {points[i].min !== null && (
              <span className="faint">
                {' '}
                · {points[i].min}–{points[i].max}
              </span>
            )}
          </div>
        </>
      )}
    >
      {(geom) => {
        const half = points.length > 1 ? (geom.x(1) - geom.x(0)) / 2 : geom.barWidth;
        return (
          <>
            {points.map((p, i) =>
              p.min === null || p.max === null ? null : (
                <rect
                  key={`band-${p.day}`}
                  x={geom.x(i) - half}
                  y={geom.y(p.max)}
                  width={half * 2}
                  height={geom.y(p.min) - geom.y(p.max)}
                  className="chart-band"
                />
              ),
            )}
            {points.map((p, i) => {
              if (p.value === null) return null;
              const top = geom.y(p.value);
              return (
                <rect
                  key={p.day}
                  x={geom.x(i) - geom.barWidth / 2}
                  y={top}
                  width={geom.barWidth}
                  height={Math.max(2, geom.baseline - top)}
                  rx={Math.min(4, geom.barWidth / 2)}
                  className="chart-bar"
                />
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}

export type WeekState = 'met' | 'missed' | 'in_progress' | 'partial' | 'no_target';

export function weekCellText(w: { count: number; state: WeekState }): string {
  if (w.state === 'met') return `${w.count} ✓`;
  if (w.state === 'in_progress') return `${w.count}…`;
  return String(w.count);
}

/**
 * One cell per Mon–Sun week, with its count. A week under target is a plain cell,
 * not amber: amber is for warnings and window violations, and the number already
 * says how far short it came.
 */
export function WeeksStrip({
  weeks,
}: {
  weeks: { week_start: string; count: number; target: number | null; state: WeekState }[];
}) {
  const hasProgress = weeks.some((w) => w.state === 'in_progress');
  return (
    <div className="strip-wrap">
      <div className="strip">
        {weeks.map((w) => (
          <div
            key={w.week_start}
            className={`strip-cell week-cell week-${w.state}`}
            title={`Week of ${longDay(w.week_start)} — ${w.count} of ${w.target ?? 'no target'}`}
          >
            {weekCellText(w)}
          </div>
        ))}
      </div>
      <div className="strip-legend">
        <LegendItem cls="week-met" label="Met" />
        <LegendItem cls="week-missed" label="Short" />
        {hasProgress && <LegendItem cls="week-in_progress" label="This week" />}
      </div>
    </div>
  );
}
```

CSS, after the compliance strip section:

```css
/* ---------- weekly strip ---------- */

.week-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  background: var(--surface-2);
}

.week-met {
  background: var(--accent);
  color: var(--bg);
}

.week-in_progress {
  border: 1px dashed var(--border);
}

.week-partial,
.week-no_target {
  color: var(--text-faint);
}

.chart-band {
  fill: var(--accent-dim);
  opacity: 0.5;
}
```

The legend swatches reuse `.strip-swatch` with these classes; check they render as filled squares (the `week-missed` swatch is `--surface-2` — give `.strip-swatch.week-missed` a `1px solid var(--border)` if it disappears against the card).

- [ ] **Step 4: Trends screen.** In `Trends.tsx`:
  - import `isOn`, `ProteinChart`, `WeeksStrip`, and `type WeekState` from charts.
  - `TrendDay` gains `protein_g: number | null; protein_min_g: number | null; protein_max_g: number | null;`
  - `Trends` gains `weights_per_week: number | null; weights_weeks: { week_start: string; count: number; target: number | null; state: WeekState }[];` and `summary` gains `avg_protein_g: number | null; protein_days_with_target: number; protein_days_in_range: number;`
  - after the Calories card:
    ```tsx
      {isOn(settings, 'protein') && (
        <div className="card">
          <div className="card-title">
            Protein
            {s.avg_protein_g !== null && <span className="faint"> · avg {s.avg_protein_g} g</span>}
          </div>
          <ProteinChart
            points={data.days.map((d) => ({
              day: d.day,
              value: d.protein_g,
              min: d.protein_min_g,
              max: d.protein_max_g,
            }))}
          />
          <div className="tiny faint">
            {s.protein_days_with_target > 0
              ? `${s.protein_days_in_range} of ${s.protein_days_with_target} logged days in range.`
              : 'No protein range set for these days — add one on Settings.'}
          </div>
        </div>
      )}
    ```
  - after the Eating window card:
    ```tsx
      {settings.exercise && (
        <div className="card">
          <div className="card-title">
            Weights
            {data.weights_per_week !== null && (
              <span className="faint"> · {data.weights_per_week} a week</span>
            )}
          </div>
          <WeeksStrip weeks={data.weights_weeks} />
        </div>
      )}
    ```

- [ ] **Step 5: Run — expect PASS.** `npm run check`.

- [ ] **Step 6: Look at it** — 14/30/90 days at 390px: band steps at the day the range started; bars zero-based; the week strip at 90 days (~14 cells) keeps its numbers legible (if not, hide text below ~22px cell width via a `week-cell` container query or by dropping the text at 90d — measure `clientWidth`). Protein off hides the card; Exercise off hides the weights card.

- [ ] **Step 7: Commit** — `Chart protein and weekly weights sessions on Trends`.

---

### Task 13: Seed, end-to-end check, docs

**Files:**
- Modify: `server/src/scripts/seed-demo.ts:155-162`, `CLAUDE.md`

- [ ] **Step 1: Seed the new plan's week.** In `seed-demo.ts`, change `WORKOUTS` to the September 2026 plan (weights twice, hiking in for a run):

```ts
const WORKOUTS: Record<number, { activity: ActivityId; minutes: number }> = {
  1: { activity: 'weights', minutes: 45 },
  2: { activity: 'climbing', minutes: 90 },
  3: { activity: 'hiking', minutes: 120 },
  4: { activity: 'weights', minutes: 50 },
  5: { activity: 'climbing', minutes: 90 },
  6: { activity: 'running', minutes: 40 },
};
```

Update any comment above it that describes the old week.

- [ ] **Step 2: Screenshot pass** — per CLAUDE.md "Verify UI changes by looking at them":

```sh
npm run create-user --prefix server -- shot
npm run seed-demo --prefix server -- shot
```

Log in as `shot`, set protein 90–130 and weights 2 "From today onward" on Settings, and also "Fix a mistake" once on a second pass to see history judged. With Playwright on installed Chrome (viewport 390×844, deviceScaleFactor 3, dark and light), capture: Settings (tree, parent off), Today (each protein state reachable by stepping days), Trends 30d and 90d. Measure: no horizontal scroll on any screen; page height stable across a day switch on Today.

Then delete the account:

```sh
sqlite3 data/app.db "PRAGMA foreign_keys = ON; DELETE FROM users WHERE username='shot';"
```

- [ ] **Step 3: CLAUDE.md.**
  - `src/settings.ts` bullet: toggles are now seven, `macros` and `protein` nested under `food`; every screen asks `isOn`; `nothingTracked` counts top-level only; the features PUT is partial so a cached older shell cannot switch newer toggles off.
  - Goals paragraph ("Goals are effective-dated…"): mention protein range and weights-per-week live in `goal_periods` too, null means no target, existing periods were left null on purpose, and a goals PUT keeps fields it does not mention.
  - `domain/` list: `trend` now also buckets weekly sessions.
  - The amber paragraph: the protein bar uses the accent green, not the protein yellow and not amber.
  - Update the test counts in "Style and workflow" to the numbers `npm test` now prints.

- [ ] **Step 4:** `npm run check`. **Commit** — `Seed the revised week, and document protein and weights targets`.

- [ ] **Step 5: Deploy note for Van (do not deploy without asking):** after `git pull` and `rebuild-restart-production.sh` on the VPS, set protein 90–130 and weights 2 on Settings with **From today onward**.
