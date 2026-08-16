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

**Editing asks which of the two you meant.** Save offers `from_today` — insert a period
starting today, leaving history alone — and `correction`, which updates **the period
covering today, in place**. Not all of history: a typo fixed in October must not silently
undo a real change made in September. When you have never changed anything there is only
one period, so a correction rewrites everything, which is exactly what fixing a typo
should do.

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
blank-line paragraphs, `**bold**`. Anything else renders as plain text. This is
formatting, not interpretation: the app never reads meaning out of your plan, and in
particular never tries to extract the numbers from it. The budget you are measured
against is the one in Settings, and writing "2400" in your plan does nothing.

Rendered to **React elements, never `dangerouslySetInnerHTML`**. No links and no images,
which keeps the entire question of what a plan is allowed to inject from arising.

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

Plus an `UPDATE users SET plan_md = '<today''s plan>' WHERE plan_md = ''`, carrying the
current hardcoded `PLAN` across as markdown. On a fresh database there are no users and it
is a no-op.

## Server

**`src/domain/goals.ts`** — pure, tested without a database or a server:

- `validateGoals(input)` — budget 500–10000, burn target 0–5000, `HH:MM` well-formed,
  `window_start < window_end`. No midnight crossing; `domain/day.ts` already assumes that
  and this is where it gets said out loud.
- `goalsForDay(periods, day)` — the covering-period rule, with the earliest-period
  fallback.

**`src/routes/settings.ts`** — new, all under `/api` and behind `requireUser`:

- `PUT /settings/goals` — the four numbers plus `scope: 'from_today' | 'correction'`.
- `PUT /settings/features` — the five booleans.
- `GET /settings/plan`, `PUT /settings/plan`.

**`GET /auth/me`** grows `goals` (today's period) and `features`. The web already fetches
it at boot, so settings need no extra request and no loading state. Plan text stays out of
it — only the Goals tab wants it, and it is the one field that can be long.

**`summary.ts` and `trends.ts`** stop reading `user.*` and call `goalsForDay` for each day
they report on, `days_under_budget` included. `store.ts` owns all the SQL as ever, and
gains the period read/write, the feature read/write, and the plan read/write.

**`create-user`** seeds an initial `goal_periods` row alongside the user, since the
defaults no longer live in a column default.

**`seed-demo`** stops writing `no_meat` / `no_dairy` and stops fabricating measured
exercise rows. It does not need to write goal periods — `create-user` has already made
one, and the fallback rule covers the six weeks it backdates.

## Web

**`markdown.ts`** — pure `renderPlan(md)` returning typed blocks (`heading` / `bullets` /
`paragraph`, with `**bold**` inline), tested the way the domain functions are.

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

Beyond that: `goalsForDay`'s fallback and boundary days; `validateGoals` at each range
edge and on a backwards window; features round-trip; plan round-trip; a second account
unable to read or write the first's goals, features or plan through any of the three new
routes; the markdown renderer as a pure function, including that unsupported syntax comes
out as text; and the optimistic-rollback path restoring a toggle when the `PUT` fails.

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

`docs/design.md` mentions the dropped columns in its schema sketch and needs the same
pass.
