# Editing a logged exercise entry

Food entries became editable in `5121a4c`. Exercise entries did not, so a run logged
as 30 minutes when it was 45 still has to be deleted and logged again. This gives
exercise the same correction, following the same rule.

## The rule that carries over, and the one thing that does not

The food edit's rule is **scale the snapshot, never re-read the source**. Pricing an
edit at the food's current per-100g figures would mean nudging a time on a March entry
quietly re-priced it, so `PATCH /log/food/:id` reads the row's own numbers and
multiplies them by one factor.

Exercise has the same exposure from a different direction. `exercise_log.kcal` is
snapshotted from `estimateKcal(activity, minutes, weightAtTheTime)`, and body weight
is the whole point of the estimate — it changes month to month by design. Re-running
the estimate on edit would re-price every past workout at today's weight.

What does *not* carry over is the food sheet's "amount and calories are two spellings
of one number". A food's calories are a measured fact you might know better than the
serving math, so typing them back-solves the amount. Exercise calories are only ever
an estimate from the MET table — `domain/exercise.ts` says so — and there is no second
source. Typing a figure could only mean *overriding* the estimate, which is a different
act from correcting an input, and nothing in the row would record that it had happened.
So calories are shown, never typed.

## The arithmetic

`kcal = MET × 3.5 × kg / 200 × minutes` is linear in both MET and minutes. So

    newKcal = kcal × (newMET / oldMET) × (newMinutes / oldMinutes)

is *exactly* what `estimateKcal` would have returned at the weight the entry was
originally priced at. The edit therefore needs no weight lookup at all — not as an
optimisation, but because not having one is what makes re-pricing impossible.

An accepted imprecision: `estimateKcal` already rounded, so repeated edits can drift a
calorie or two. It is an estimate scaled by an estimated weight; that is below the
noise floor.

## Server

### `src/domain/exercise.ts`

```ts
rescaleBurn(
  entry: { activity: string; minutes: number; kcal: number },
  next: { activity: ActivityId; minutes: number },
): number
```

Rounded, as `estimateKcal` is. It refuses rather than guesses in two cases, the way
`factorForKcal` refuses a zero-calorie entry:

- `entry.minutes <= 0` or `entry.kcal <= 0` — nothing to scale from.
- `entry.activity` is not in `ACTIVITIES` — no MET to scale from. Only reachable if an
  activity is dropped from the table after something was logged against it, but a
  silently wrong calorie figure is worse than a refusal.

### `src/store.ts`

`getExerciseEntry(db, userId, id)` and `updateExercise(db, userId, id, { activity,
minutes, kcal })`. Both filter on `user_id`, as everything in that file does.

`updateExercise` writes those three columns and no others. `local_day` and `logged_at`
are left exactly as they were — unlike the food edit, which recomputes `local_day` from
the new `eaten_at`, nothing here can change which day the entry belongs to, so there is
nothing to keep in step.

### `src/routes/day.ts`

`PATCH /log/exercise/:id`, mirroring `PATCH /log/food/:id`:

- 400 on a non-integer id; 404 when the entry is not this user's.
- Body `{ activity?: string; minutes?: number }`. Neither present → 400 "Nothing to
  change".
- Unknown activity → 400, listing the valid ids as the POST does.
- Non-positive or non-finite minutes → 400.
- `rescaleBurn` throwing → 400 with its message.
- Success returns `{ entry }`, as the POST does.

The route deliberately does **not** call `latestWeight`. The POST needs a weight
because it has no prior figure to work from; the PATCH has one, and looking one up is
exactly the bug this design exists to prevent.

## Web

### `src/exercise.ts`

A client mirror of `rescaleBurn` for the live preview, carrying the header
`nutrition.ts` carries: the server recomputes on save and this never decides what gets
stored. MET values come from the `Activity` objects already fetched from `/activities`
— which carry `met` — so there is no second copy of the MET table on the client.

### `src/components/EditExercise.tsx`

A sheet mirroring `EditEntry`: the activity `<select>` that `ExerciseInput` already
renders, a minutes input, the rescaled calories shown live as a read-only figure, then
Delete set apart from the pair, then Cancel / Save.

### `ExerciseList`

Rows become `<button>`s that open the sheet and lose their `×` — the same change the
food list went through. Delete moves into the sheet, where reaching it costs a tap.

### `Today.tsx`

An `editingExercise` state beside the existing `editing`, rendered next to
`<EditEntry>`, bumping `version` on save.

## Out of scope

**The time and the day stay put.** `logged_at` is not displayed anywhere and nothing
derives from it — the eating window reads food timestamps only, so it merely orders
the list. A control for a value nothing reads is clutter. Moving an entry to another
day is a capability the food edit does not have either (its sheet writes a wall-clock
time onto the day already on screen), so adding it here would break the symmetry
rather than complete it. Logging a workout on the wrong day still means delete and
re-log.

**No calorie override.** See above.

## Tests

Domain (`server/src/__tests__`):

- Scales by minutes alone, by activity alone, and by both.
- An edit to the same values returns the identical kcal — the real proof the original
  weight basis survives a round trip.
- Refuses zero minutes, a zero-kcal entry, and an activity not in the table.

Route (Fastify `app.inject()`):

- A minutes edit rescales the calories and persists them.
- An unknown activity is a 400; another user's entry is a 404; an empty body is a 400.
- **The one that matters:** log at one body weight, record a different weight, then
  edit the entry, and assert the calories stayed proportional to the original rather
  than being re-estimated. This is the exercise counterpart of the food snapshot test.

Web: the mirror function against the same scaling cases.
