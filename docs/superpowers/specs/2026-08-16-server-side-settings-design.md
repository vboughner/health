# Settings on the account, not the device

**Date:** 2026-08-16
**Status:** approved, not yet implemented

## The idea

Everything the app treats as a setting moves to the server, per account, and gets a
Settings screen worth the name.

Three things move, and they move for the same reason: one account should mean one set of
settings on every device you sign into.

1. **The goal numbers** — calorie budget, daily burn target, eating window. They already
   live on the user; nothing can edit them.
2. **The tracked features** — diet, exercise, sleep, weight, goals. They live in
   `localStorage` today, per device.
3. **The plan itself** — the prose on the Goals tab, currently a hardcoded copy of
   `Personal/Mid-2026 Goals.md`. It becomes text the account owns and the user edits.

The third is the one that changes the shape of the project. Until now the vault note was
the source of truth for the goals and the app was a measuring stick built to match it.
After this the app holds its own plan, per account, and the two are **decoupled**: a
second user will want to write their own plan, and there is no reason it should live in
someone else's Obsidian vault. Keeping the note in step is a personal habit from here on,
not something the app knows about.

## Decisions taken

**Goals are effective-dated; past days are judged by what was in force then.** The
eating window is evaluated per request rather than snapshotted, so widening it today
retroactively un-violates every past day. That is right for fixing a typo and wrong for a
genuine September schedule change. The same is true of the budget — `trends.ts:112`
computes `days_under_budget` against the live figure — and of the burn target.

So a `goal_periods` table holds the four numbers with an `effective_from` day, and every
rollup asks what the goals were on the day it is reporting on.

**Editing asks which of the two you meant.** Save offers `from_today` — a period starting
today, leaving history alone — and `correction`, which updates **the period covering
today, in place**. Not all of history: a typo fixed in October must not silently undo a
real change made in September. When you have never changed anything there is only one
period, so a correction rewrites everything, which is exactly what fixing a typo should
do.

`from_today` is an upsert, not an insert — the unique index would otherwise reject a
second edit on the same day. Which means the two scopes **converge once you have already
edited today**: the period covering today is the one starting today, so both write the
same row. Nothing needs to special-case that, but it is worth knowing before it looks like
a bug.

**A range can span more than one set of goals, and the Trends chart has to admit it.**
`CalorieChart` takes a single scalar `budget` today and uses it three ways: the reference
line, the axis `include`, and the over/under colour on every bar at `charts.tsx:213`. Once
`days_under_budget` is counted per day, a flat line drawn at *today's* budget would colour
bars by one rule while the caption beneath counts them by another — "18 of 30 logged days
at or under budget" sitting under a chart that reds a different 12. That is the kind of
quiet contradiction this app is otherwise careful about.

So the day rows carry their own `budget`, the reference line becomes a stepped polyline,
and each bar is coloured against the budget of its own day. In the common case — goals
unchanged across the range — the polyline is flat and nothing looks any different.

The `burn_target` tile stays a single figure, today's. It compares an average across the
whole range to what you are aiming at *now*, which is what that tile has always meant; a
stepped target for an averaged number would not mean anything more precise.

**The four goal columns come off `users` entirely.** `goal_periods` is the only store;
"current goals" is the period covering today. Keeping the columns as a live copy beside a
history is two sources of truth, and this repo already has a standing complaint about
things left half-wired.

**Period lookup falls back to the earliest period** rather than using a sentinel date. Day
*D* takes the greatest `effective_from <= D`, and if none covers it, the earliest period
there is. No magic `0000-01-01`, and `seed-demo`'s six weeks of backdated history resolve
without special-casing.

**Tracked features become five columns on `users`**, not a JSON blob. It matches the rest
of the schema, it lets the server type them, and it makes "an unknown key leaked into the
settings object" structurally impossible instead of something a test has to guard — there
is such a test today. A sixth toggle later is a one-line migration, which is a fair price.

`nothingTracked()` keeps asking `FEATURES` rather than a list of its own, so a toggle
added later is still counted without anyone remembering to. That property survives the
move unchanged, because it was never about where the values were stored.

**The toggles already in `localStorage` are ignored, not adopted.** The server's defaults
win and the stale `health:settings` key is deleted on load. Adopting them would need a
"never chosen" sentinel on the server, and would mean the first device to open the app
after the upgrade silently wins any disagreement. Five checkboxes take seconds to re-set,
once, forever.

**The plan is markdown, rendered from a small fixed subset.** `##` headings, `-` bullets,
blank-line paragraphs. Nothing else — no bold, no links, no images. Anything unrecognised
renders as the plain text it is.

Dropping inline formatting is what keeps this small: with no spans to parse, `renderPlan`
is a line classifier and a grouping pass, and a block is a string rather than a tree.
Bold would roughly double both the renderer and its tests to buy emphasis in a document
one person reads to themselves. The plan it replaces uses none.

This is formatting, not interpretation: the app never reads meaning out of your plan, and
in particular never tries to extract the numbers from it. The budget you are measured
against is the one in Settings, and writing "2400" in your plan does nothing.

Rendered to **React elements, never `dangerouslySetInnerHTML`**. With no links or images
in the subset, the question of what a plan is allowed to inject never arises.

**A new account starts with no plan at all.** The Goals tab shows a short card with a
Write button, and the editor opens blank with placeholder text demonstrating `##` and
`-`. Nothing is put in anyone's mouth. Migration 005 seeds the existing account with
today's hardcoded plan verbatim, so the Goals tab is unchanged the moment this ships.

**Settings need the network, and say so honestly.** `sw.js` deliberately caches the app
shell only — no API responses, no queued writes — because showing a food as logged when
it never reached the server is worse than an honest failure. A setting is no different.
Nothing is queued for later.

A toggle flips immediately and the request follows; a failure flips it back with an inline
reason. The goal form and the plan editor save on a button press and keep your edits on
screen when it fails, since you pressed something and can press it again.

**Timezone stays uneditable.** It is on `users`, it is not part of what was asked for, and
changing it retroactively re-buckets every `local_day` in the database — a much larger
question than this one.

## Orphaned fields, cleared out

`daily_entries.no_meat` / `no_dairy` are check-in boxes that were removed from the UI as
more nagging than useful, leaving columns, patch fields, boolean coercion, both `DayEntry`
types, `seed-demo` writes and test assertions with nothing on the other end. CLAUDE.md has
said for a while to either give them a home or drop them.

This change strengthens the case: once the plan is prose a user writes themselves, "no
meat" and "no dairy" as fixed columns are assumptions about *one person's* diet baked into
the schema. An audit of every column and API field against the web found four more of the
same kind, and one near-miss:

| Field | Reach | Verdict |
| --- | --- | --- |
| `daily_entries.no_meat` / `no_dairy` | column, patch field, `DayEntry` both sides | drop |
| `daily_entries.note` | column, patch field, `DayEntry.note` both sides | drop — never had a UI |
| `exercise_log.note` | column, `POST /log/exercise` body, `ExerciseEntry.note` | drop — never sent, never shown |
| `DaySummary.exercise.estimated` / `measured` / `measuredShare` | computed in `summary.ts`, typed in `types.ts` | drop — rendered by nothing |
| `exercise_log.source` + `POST` body `kcal` | column, CHECK constraint, branch in `day.ts` | drop — see below |
| `foods.added_sugar_g` / `sodium_mg` | columns, never displayed | **keep** |

Every apparent `note` reference in the web turned out to be a CSS class name.

**`added_sugar_g` and `sodium_mg` are not orphans** despite appearing nowhere on screen.
They are inputs to `domain/processed.ts`, whose thresholds produce the `processed_flags`
the UI does render. They look dead from the web and are not.

**The measured/estimated split goes, and that is a product decision rather than
cleanup.** The "calories from your watch" field was removed from the form deliberately —
`DayInputs.tsx:151` says as much — but the route kept accepting `kcal` and labelling such
rows `measured`. What makes it worth ending: no UI has sent `kcal` since, so real data is
100% estimated and `measuredShare` is permanently zero; the split only *looks* exercised
because `seed-demo.ts:299` fabricates 40% measured rows. Exercise calories are a MET
estimate scaled by body weight, and now the schema says so.

Consequence: the weight requirement in `POST /log/exercise` is no longer escapable, so its
400 stops offering an alternative that no longer exists — "Record a weight first" rather
than "Record a weight first, or enter the calories from your watch".

SQLite drops a column-level CHECK along with its column, verified on both the 3.43.2 CLI
and the 3.49.2 that better-sqlite3 bundles, so `exercise_log.source` needs no table
rebuild.

## Data model

Migration `005`:

```sql
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
```

Seeded from each existing user's four columns, after which those columns are dropped.

`effective_from` for that seeded row is the **UTC** day of `created_at`
(`date(created_at/1000, 'unixepoch')`), not the local one: a `.sql` migration cannot
resolve an IANA timezone. Being a day out costs nothing, because it is the earliest period
and the fallback rule already covers every day before it.

```sql
ALTER TABLE users ADD COLUMN track_food     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_exercise INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_sleep    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_weight   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_goals    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN plan_md        TEXT    NOT NULL DEFAULT '';

ALTER TABLE users DROP COLUMN daily_kcal_budget;
ALTER TABLE users DROP COLUMN daily_burn_target;
ALTER TABLE users DROP COLUMN window_start;
ALTER TABLE users DROP COLUMN window_end;

ALTER TABLE daily_entries DROP COLUMN no_meat;
ALTER TABLE daily_entries DROP COLUMN no_dairy;
ALTER TABLE daily_entries DROP COLUMN note;
ALTER TABLE exercise_log  DROP COLUMN note;
ALTER TABLE exercise_log  DROP COLUMN source;
```

Plus an `UPDATE users SET plan_md = ...` carrying the current hardcoded `PLAN` across as
markdown, with the text inlined in the migration. It applies to every account existing at
migration time, which is one; on a fresh database there are none and it is a no-op.
Accounts created afterwards get the `''` default and the empty state.

## Server

**`src/domain/goals.ts`** — pure, tested without a database or a server:

- `DEFAULT_GOALS` — 2400 / 960 / `09:00` / `19:00`. These were column defaults in
  migration 001; with the columns gone they need a home in code, and this is it.
- `validateGoals(input)` — budget 500–10000, burn target 0–5000, `HH:MM` well-formed,
  `window_start < window_end`. No midnight crossing; `domain/day.ts` already assumes that
  and this is where it gets said out loud.
- `goalsForDay(periods, day)` — the covering-period rule, with the earliest-period
  fallback.

**`src/routes/settings.ts`** — new, all under `/api` and behind `requireUser`:

- `PUT /settings/goals` — the four numbers plus `scope: 'from_today' | 'correction'`.
- `PUT /settings/features` — the five booleans.
- `GET /settings/plan`, `PUT /settings/plan`.

**`auth.ts`'s `User` gains the five feature booleans and nothing else.** This matters more
than it looks: `getSessionUser` calls `getUserById` on **every authenticated request**, so
whatever `User` carries is read on every request. The features are five integers on a row
already being fetched, so they are free. Goals are not — they are a second table and would
add a query per request to serve one route. Plan text is not either; it is the one field
that can run to kilobytes.

So `request.user` stays narrow, and:

**`GET /auth/me`** composes `goals` (today's period) on top of the user it already has.
The web fetches it at boot, so settings need no extra request and no loading state. The
plan gets its own `GET /settings/plan`, fetched by the Goals tab that wants it.

**`summary.ts` and `trends.ts`** stop reading `user.*`, load the user's periods once, and
call `goalsForDay` per day they report on — `days_under_budget` and the per-day `budget`
on each trends row included. `store.ts` owns all the SQL as ever, and gains the period
read/write, the feature write, and the plan read/write.

**`auth.ts`'s `createUser` seeds the initial `goal_periods` row** from `DEFAULT_GOALS`,
inside the same transaction as the user insert. Not the `create-user` script: `createUser`
is what the test helpers call too (`__tests__/helpers.ts:94`), so putting it here means
every account in every test has goals without anyone arranging it.

**`seed-demo`** stops writing `no_meat` / `no_dairy` and stops fabricating measured
exercise rows. It does not need to write goal periods — `create-user` has already made
one, and the fallback rule covers the six weeks it backdates.

## Web

**`markdown.ts`** — pure `renderPlan(md)` returning typed blocks (`heading` / `bullets` /
`paragraph`), each carrying plain strings, tested the way the domain functions are.

**`components/charts.tsx`** — `CalorieChart` takes a budget per point instead of one
scalar: the reference line becomes a stepped polyline, `scale.include` covers every budget
in the range rather than one, and each bar compares against its own day's.

**`settings.ts`** keeps `Settings`, `FEATURES` and `nothingTracked` exactly as they are.
`readSettings` / `writeSettings` go, replaced by a one-shot `clearLegacySettings()` that
removes `health:settings` at boot.

**`screens/Settings.tsx`** becomes three cards — **Goals** (budget, burn target, window,
with the two scope buttons behind Save), **Track** (the toggles), **Account** (log out) —
plus a line saying these now apply to every device signed into the account. The goal form
moves to `components/GoalsForm.tsx` so the screen stays small.

**`screens/Goals.tsx`** loses its `PLAN` constant, fetches the plan, renders it, and gains
an edit mode (textarea, Save, Cancel) and the empty-state card.

**`components/DayInputs.tsx`** loses the doc comment on `ExerciseInput` explaining that the
API still accepts a watch figure, since it will not.

**`types.ts`** loses `DayEntry.no_meat` / `no_dairy` / `note`, `ExerciseEntry.note` /
`source`, and the three `DaySummary.exercise` fields; `User` loses the four goal numbers
and gains `goals` and `features`.

## Testing

The load-bearing one: **a day before an edit keeps its old verdict under `from_today` and
changes under `correction`.** That is the whole reason `goal_periods` exists, and it is
the regression that would otherwise be invisible until September.

Close behind it: **a trends range spanning a budget change reports each day against its
own budget**, so `days_under_budget` and the per-row figure the chart colours by cannot
drift apart.

Beyond those: `goalsForDay`'s fallback and boundary days; `validateGoals` at each range
edge and on a backwards window; the two scopes converging when a period already starts
today; features round-trip; plan round-trip; a second account unable to read or write the
first's goals, features or plan through any of the new routes; the markdown renderer as a
pure function, including that unsupported syntax comes out as text; and the
optimistic-rollback path restoring a toggle when the `PUT` fails.

`auth.test.ts:117` asserts `daily_kcal_budget` on the `/auth/me` payload and moves to the
new shape.

`settings.test.ts` loses its `localStorage` cases and keeps the `nothingTracked` ones,
including the test that `FEATURES` covers every key — that guard matters more now, not
less, since the keys are columns.

## Documentation

CLAUDE.md needs more than a touch-up:

- The opening paragraph stops calling the vault note the source of truth. The plan lives
  in the app, per account.
- The `src/settings.ts` bullet is rewritten from per-device `localStorage` to per-account
  server state. The existing text argues the per-device design was deliberate; it is
  deliberately reversed, and should read that way rather than being quietly edited.
- New entries under "Things that are subtle": goals are effective-dated and editing asks
  which kind of change you meant; settings need the network and do not queue.
- The `no_meat` / `no_dairy` note under "Data model notes" goes away with the columns.

`docs/design.md` needs the same pass in more places than the schema sketch: line 5 opens
by making the vault note the premise of the whole project, lines 68–69 list the four goal
columns, line 80 lists `source` and `note`, line 82 lists `no_meat` / `no_dairy` / `note`,
line 108 describes the Goals tab as showing "The Plan" from the vault note, and line 177
says the note stays the source of truth for the goals.
