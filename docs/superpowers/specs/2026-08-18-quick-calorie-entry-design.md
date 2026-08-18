# Log calories only

**Date:** 2026-08-18
**Status:** approved, not yet implemented

## The idea

Sometimes you know what you ate and roughly what it cost, and searching for it is wasted
work: a bowl from the place round the corner, a coffee with oat milk, someone's birthday
cake. Today the only way to log that is Enter A Food By Hand, which saves a food you will
never pick again and asks for macros nobody has.

A third path on the Eat Food screen: a name, a calorie figure, a time, done. It writes one
line in the day's log and creates nothing else. No macros are asked for, and the macros it
does not have are not allowed to pass as zeros.

## Decisions taken

**It saves no food.** The point is to avoid adding a food that will clutter search and
"Eaten often" for one bowl of soup. `food_log.food_id` is already nullable, so this is a
log row with no food behind it. Nothing to reuse, nothing to re-pick, and none of the
frequency lists notice it. The cost is that a phrase you type often gets typed often;
recalling recent quick names is deliberately out of scope until that actually annoys.

**Absent macros are flagged, not stored as zeros and forgotten.** Migration 008 adds
`macros_unknown` to `food_log`. Arithmetically the zeros are already harmless — `macroSplit`
divides macro-derived calories by each other, so an entry with no macros contributes
nothing to the percentages and the split is drawn from the recorded foods alone. The flag
is what stops "nobody wrote them down" reading as "this food has none", which is the same
distinction `weight_unknown` draws for grams. Both flags are set on these rows, and both
live on the log row only — there is no food behind them to snapshot from.

**The day says how much of it is uncounted.** The macro bar keeps meaning what it means:
100% of the macros that are known. Underneath it, when there are any, a plain line —
`910 of 1220 cal have no macros on record`. Sizing a grey "unknown" segment into the bar
instead was rejected: it would turn the bar into a split of all calories, and the
percentages read off it would no longer be the ones the 80/10/10 target is judged against.
The line shows at any amount above zero rather than past a threshold; a threshold means the
day is quietly wrong until it is loudly wrong.

**It is not amber.** `--warn` is for warnings and window violations. This is a statement
about coverage, and it is `tiny faint`.

**The eating window counts it.** First and last bite come from `food_log` timestamps, and a
quick entry is a real bite at a real time. The time field matters here for the same reason
it matters in the log sheet, and it is prefilled the same way: now, or midday when
backfilling another day.

**The calorie budget counts it in full.** It is food you ate.

**No quantity multiplier.** You type the calories you ate. Two bowls is one entry with the
calories of two bowls, or two entries.

**Its own sheet, not a mode inside ManualFood.** That sheet is titled "New food" and exists
to make one; this makes none. It also shares nothing with it — no macro fields, no gram
basis, no per-100g arithmetic, and no hand-off to `LogSheet` afterwards, because `LogSheet`
exists to pick an amount and here there is no amount to pick.

**Its own route, not a third branch of `POST /log/food`.** That route resolves a food,
converts to grams, scales per-100g figures and checks the processed-food flags. A quick
entry does none of it. A third shape squeezed into that body would make the route about
telling three cases apart.

## Data model

Migration `008_quick_entry.sql`:

```sql
ALTER TABLE food_log ADD COLUMN macros_unknown INTEGER NOT NULL DEFAULT 0;
```

A quick entry's row:

| column | value |
| --- | --- |
| `food_id` | `NULL` |
| `food_name` | the phrase typed |
| `kcal` | the figure typed |
| `protein_g`, `fat_g`, `carb_g` | `0` — meaningless, guarded by the flag |
| `quantity`, `unit`, `grams` | `1`, `'serving'`, `0` |
| `weight_unknown` | `1` |
| `macros_unknown` | `1` |
| `eaten_at`, `local_day` | from the chosen time, in the user's timezone |

`unit` stays `'serving'` rather than gaining a fourth value: a new unit would have to mean
something to `toGrams`, and this row is never converted.

## Server

**`POST /api/log/quick`** in `routes/log.ts`, beside the existing handlers.

Body `{ name: string, kcal: number, eaten_at?: number }`. `eaten_at` defaults to now.
Rejects an empty name and a kcal that is not a positive finite number, both `400`. Returns
`201 { entry }`, the same `FoodLogEntry` shape the other log routes return. There is no
`warning` field: warnings come from a food's processed flags and there is no food.

`DELETE /log/food/:id` already deletes it; `GET /log/food` already lists it.

**Domain** (`domain/nutrition.ts`, pure, tested without a server):

- `quickNutrition(kcal): Nutrition` — validates and returns `{ kcal, protein_g: 0, fat_g: 0, carb_g: 0 }`.
- `unaccountedKcal(entries): number` — sums `kcal` over entries flagged `macros_unknown`.

**Store**: `NewFoodLog` and `insertFoodLog` carry `macros_unknown`; both select lists and
`toFoodLogEntry` return it as a boolean.

**`GET /summary/:date`**: `food` gains `macro_unknown_kcal`, from `unaccountedKcal`.
`macroSplit` is untouched.

**`/trends`**: unchanged. It returns macro grams per day, but no screen draws them, so there
is no macro average over a range to distort. If one is ever drawn, this flag is what it will
need.

## Web

**`components/QuickFood.tsx`** — a sheet in the shape of `ManualFood`: name, calories, a
time row reusing `nowTime()` / `atTimeOn()` and the midday backfill default, Cancel and
Log It. A line under the title says what it is: calories only, no macros, no food saved.
Submit posts once to `/log/quick` and calls the screen's existing `onLogged`, so it toasts
and closes like every other path.

**`screens/AddFood.tsx`** — a second full-width button, `Log Calories Only`, above the
lists next to `Enter A Food By Hand`, for the same reason that one sits there: it is the
way out when search has failed you, and at the foot of a long list it is the thing you
scroll past everything to reach.

**`screens/Today.tsx`** — `formatAmount` returns `calories only` for a `macros_unknown`
entry rather than `1 × serving`, which is bookkeeping showing through. Under `MacroBar`,
when `macro_unknown_kcal > 0`, the coverage line.

**`types.ts`** — `FoodLogEntry.macros_unknown: boolean`, `DaySummary.food.macro_unknown_kcal: number`.

## Tests

- **Domain**: `quickNutrition` accepts a positive figure and rejects zero, negatives and
  non-finite ones; `unaccountedKcal` over a mix of flagged and unflagged entries, and over
  an empty day.
- **Route** (`app.inject`, in-memory database): a quick entry stores `food_id NULL` with both
  flags set and creates no `foods` row; it counts toward the day's calories; the day's
  `macros` are byte-identical with and without it present; `macro_unknown_kcal` matches the
  sum; a missing name and a non-positive kcal are both `400`; `eaten_at` files it on the
  right `local_day` and moves the eating window's ends.
- **Web**: `formatAmount` for a macros-unknown entry; the coverage line renders above zero
  and is absent at zero.

## Verification

Checked on screen against a throwaway seeded account before it is called done — a quick
entry in the day list, the coverage line under the macro bar with and without one, and the
new button on Eat Food at 390×844. The account and its rows are deleted afterwards, with
foreign keys on.
