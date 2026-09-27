# Protein target, weights per week, and hiking

`Personal/Mid-2026 Goals.md` was revised in September 2026. The priority moved from
losing 20 lb to keeping muscle, and three things the app shows became wrong or missing:

- **Protein.** The new target is 90–130 g/day. The macro bar was built for 80/10/10,
  where ~10% protein (~60 g) reads as on-plan. A share of calories cannot express a
  gram target, so protein gets one of its own.
- **Weights.** The plan moved from one session a week to 2–3. Nothing counts them.
- **Hiking.** Running is being reduced in favour of hiking, which is not in the list.

Out of scope, deliberately: the hardcoded −0.5 lb/week line on Trends, waist size,
protein per meal, fatigue, calcium, and future-dated goal changes. Each was discussed
and deferred.

## Data

### Migration 009: goal columns

```sql
ALTER TABLE goal_periods ADD COLUMN protein_min_g    INTEGER;  -- null = no target
ALTER TABLE goal_periods ADD COLUMN protein_max_g    INTEGER;
ALTER TABLE goal_periods ADD COLUMN weights_per_week INTEGER;  -- null = no target
```

**Existing periods get null, not 90–130 and 2.** Filling them would re-judge every day
since August against goals adopted in late September, which is exactly what
effective-dating exists to prevent. After deploying, the targets are set on Settings
with *From today onward*, and history keeps saying "no target".

`DEFAULT_GOALS` gains the three fields as null. The existing defaults came from a plan
written for a general fat-loss goal; these numbers are specific to one person's
revised plan and should not be handed to a new account.

### Migration 009 (same file): two feature toggles

```sql
ALTER TABLE users ADD COLUMN track_macros  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_protein INTEGER NOT NULL DEFAULT 1;
```

Both default on, so nothing disappears for an account on deploy.

## Goals: `domain/goals.ts`

`Goals` gains `protein_min_g`, `protein_max_g`, `weights_per_week`, each
`number | null`. `validateGoals` adds, with messages in the existing style:

- Protein min and max are both null or both set. One without the other is a 400
  ("Set both ends of the protein range, or neither").
- When set: whole numbers, `0 < min ≤ max ≤ 400`.
- `weights_per_week` is null or a whole number `0–14`. Zero is meaningful — a week
  with a zero target (a rest week) is met by doing nothing, never missed.

`PUT /settings/goals` stores the three new fields alongside the old four, field by
field as it does now. `goalsForDay`, the scope rule, and `putGoalPeriod` are otherwise
unchanged.

## Feature toggles: nested

The Track list becomes a small tree:

```
Diet                  track_food
  Macros              track_macros
    Protein target    track_protein
Exercise              track_exercise
Sleep / Weight / Goals
```

- **Effective value = own value AND every ancestor's.** Stored independently, so
  turning Diet off and on again restores Macros and Protein as they were. A child
  whose parent is off is drawn dimmed and inert, showing its own stored position.
- `FEATURES` (web) gains a `parent?: keyof Settings` field; a pure `isOn(settings,
  key)` walks it. Every consumer — Today, Trends, GoalsForm dimming — asks `isOn`
  rather than reading a flag directly, so a nested toggle cannot be half-respected.
- `nothingTracked()` counts only top-level features. Macros on under Diet off draws
  nothing.
- Diet's detail line drops "macros" (it now has its own row). Macros: "The split of
  carbs, protein and fat." Protein target: shows the current range ("90–130 g a
  day") or "No range set — add one under Goals".

**Server: `domain/features.ts`.** `FEATURE_KEYS` and `FEATURE_COLUMNS` gain `macros`
and `protein`; the server stores flat booleans and knows nothing about nesting, which
is a drawing concern.

**`PUT /settings/features` becomes a partial update.** Today a body missing any key is
a 400. After deploy, a phone still running the cached five-toggle shell would send five
keys and every toggle would fail until the app reloaded. So: a missing key keeps its
stored value; a present key that is not a boolean is still a 400; unknown keys are
still ignored. The response returns the full set.

## What each toggle hides

"Off" hides and keeps, like every toggle today. The range stays in `goal_periods`.

| Effective off | Today | Trends | Settings |
|---|---|---|---|
| Macros | Macro split bar and protein bar; card retitles "Eating window" | Protein chart | Protein range row dimmed |
| Protein target | Protein bar | Protein chart | Protein range row dimmed |
| Exercise | (unchanged) + nothing new | Weights strip | Weights row dimmed |

There is no sub-toggle for the weights target. Clearing the field (null) turns it off
from a chosen day; asked for protein only.

## Today

Under the macro split, inside the same card, a protein bar:

```
Protein   72 g of 90–130 g
[██████████░░░░|▒▒▒▒▒▒|░░]
```

- Zero-based, scaled so the max sits at ~85% of the width, the band drawn between min
  and max. Fill is neutral below min, green inside the band. Above max it keeps
  filling in the same green — too much protein is not the risk this tracks, so it is
  never a warning. Amber (`--warn`) is not used, and neither is the protein yellow:
  the bar is about hitting a target, not about which macro it is. Re-run the CVD
  validator for the in-range green against the macro bar directly above it.
- **Quick entries** (`macro_unknown_kcal > 0`): the figure is a floor, so it reads
  "72+ g". Nothing is extrapolated.
- **No range set** for the shown day: "Protein 72 g", no bar.
- The day's range comes from the summary for `shown`, i.e. `goalsForDay` on the
  server — `GET /summary/:date` gains `food.protein = { grams, min, max }`.
- Collapsed card summary gains "72 g protein" when the protein bar would be drawn.

The pure part — state of the bar (below / in / above / no-target, floor or exact) and
its widths — goes in a web helper with tests; the component stays thin.

## Trends

**Protein chart.** Daily grams as zero-based bars, the band drawn as a shaded strip
that steps where the range changed (each day carries its own `protein_min_g` /
`protein_max_g`, like `budget`). Days with no target draw bars with no band. Headline:
"avg 84 g · 9 of 30 days in range", where the denominator is logged days that *had* a
target. Hidden when macros or protein is effectively off.

**Weights strip.** One cell per Monday–Sunday week overlapping the range.

- A **session is a day** with at least one `weights` entry. Two logs on one day count
  once.
- A week's target is the `weights_per_week` of the period covering its **Monday**;
  a week with a null target shows its count uncoloured.
- Met → `2 ✓`. The current week, not yet met, reads as in progress (`1…`), never as a
  miss. Past weeks under target read as a miss in the usual non-warn styling.
- The first week is partial when the range starts mid-week; its count covers only the
  days in range, and it is marked partial rather than judged.

`domain/trend.ts` gains `weeklySessions(days: {day, weights: boolean}[], periods,
today)` returning `{ week_start, count, target, state }[]`. `burnByDay` or a sibling
store query supplies which days had a weights entry. `/trends` returns `weights_weeks`
alongside `days`.

## Hiking

`hiking: { label: 'Hiking', met: 6.0 }` — Compendium code 17080, "hiking, cross
country". Inserted after climbing. No migration: `exercise_log.activity` is free text
checked against `ACTIVITIES` at write time.

## Testing

- **Domain:** `validateGoals` for every new rule; `weeklySessions` across week
  boundaries, a partial first week, the current week, same-day duplicates, a target
  change mid-range, zero and null targets. Protein-bar state helper (web).
- **Routes:** goals round-trip with the new fields; a migrated account reads nulls;
  partial `PUT /settings/features` keeps omitted keys and 400s a non-boolean; summary
  carries the day's own range; trends judges each day and week by its own period;
  user isolation for the new query.
- **Web:** `isOn` nesting and `nothingTracked` ignoring children.
- **On screen:** throwaway seeded account, 390×844 dark: Settings tree with parent
  off, Today bar in each state, Trends chart and strip. Delete the account after.
