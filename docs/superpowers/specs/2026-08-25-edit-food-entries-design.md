# Editing a logged food entry

Date: 2026-08-25

## The problem

A food entry is write-once. You can log it and you can delete it, and that is all.
The times are the ones the eating window is derived from and the calories are the
ones the budget is spent against, so a mistyped amount or a meal logged an hour
late has to be deleted and entered again from scratch — including finding the food
a second time.

## What edit means

Editing scales **the entry's own snapshot**, never the food behind it.

`food_log` already stores its calories, macros and grams as of log time, precisely
so that re-caching a food from USDA cannot rewrite what a past day says you ate.
Editing against the food's *current* per-100g figures would reopen exactly that
hole from the other side: changing only the *time* on an entry logged in March
would silently re-price it at today's figures. Scaling the stored snapshot makes
that impossible, and has the pleasant side effect that editing needs no food
lookup at all — not on the server, not on the client.

Two consequences follow.

**The unit is fixed at what it was logged in.** You edit `150 g` to `200 g`, or
`1 serving` to `1.5`, but you cannot switch g→serving, because the serving size
lives on the food and the entry only knows the grams it worked out to. This is a
restriction the snapshot rule buys, not an oversight.

**Amount and calories are two views of one number.** Type either and the other
follows. Editing a 150 g / 247 cal entry to 400 cal back-solves the amount to
243 g and scales the macros by the same factor 400/247. Nothing detaches from the
food; `weight_unknown` and `macros_unknown` are carried through untouched. This
was chosen over two alternatives — leaving the amount alone and scaling macros to
the new calories, or leaving the amount alone and dropping the macros as
`macros_unknown` — because both of those produce an entry whose parts no longer
agree with each other, and the flag exists to mark figures nobody measured rather
than figures we chose to stop believing.

A **quick entry** — the `food_id IS NULL` kind, name and calories and nothing else
— has no amount to scale, so its edit is its name, its calories and its time, with
the calories set directly.

## Server

**No migration.** Every column involved already exists on `food_log` and is
already written at insert.

`src/domain/nutrition.ts` gains two pure functions:

- `scaleNutrition(n: Nutrition, factor: number): Nutrition` — all four figures by
  one factor, rounded the way the rest of the module rounds.
- `factorForKcal(loggedKcal: number, kcal: number): number` — what multiple of
  what was logged a calorie figure represents. Throws when `loggedKcal <= 0`:
  there is no amount of a zero-calorie food that comes to 400 calories, so that
  edit is refused rather than divided by zero.

`PATCH /log/food/:id` loads the entry scoped to the user — 404ing on an id that is
not theirs, exactly as `DELETE` already does — and branches on whether it has a
food behind it:

- **A food entry** accepts `quantity`, or `kcal`, or `eaten_at`. Given `kcal`, the
  quantity is `entry.quantity * factorForKcal(entry.kcal, kcal)`. Either way one
  factor (`newQuantity / entry.quantity`) scales the grams and all four nutrition
  figures. `unit` is not accepted.
- **A quick entry** accepts `name`, `kcal`, or `eaten_at`. Quantity stays 1, grams
  stay 0, macros stay zero, and both flags stay set.

Every field is optional; only what is sent changes. Sending both `quantity` and
`kcal` on a food entry is a 400 — they are two spellings of the same edit and
picking a winner would silently discard the other.

`local_day` is recomputed from `eaten_at` on every write, even though the UI
cannot currently move an entry across midnight. A denormalized day that disagrees
with its own timestamp is the kind of thing that is discovered months later in a
rollup.

**One route, not two.** The two POSTs are deliberately separate because the
inputs to each are wholly different on the way in. On edit the row already exists
and its id determines which shape applies, so a client holding an id should not
have to decide which URL to send it to.

## Web

**The row becomes the way in.** The `Eaten` list's rows become buttons that open
the sheet; the per-row `×` goes away and Delete moves inside. One hit area per
row instead of two side by side under a thumb, and deleting costs two taps
instead of one, which is the right price for the irreversible one.

**`components/EditEntry.tsx`**, a new bottom sheet. Deliberately not a mode of
`LogSheet`, for the same reason `QuickFood` is not a mode of `ManualFood`:
`LogSheet` prices a food from its per-100g figures and its whole preview is built
on having one, while this sheet scales a row that may have no food at all. It
holds:

- the name — a heading for a food entry, a text input for a quick entry
- an amount input with the unit as a fixed label, absent for a quick entry
- a calorie input
- a time input, as `LogSheet` and `QuickFood` have
- a scaled `MacroBar`, absent when `macros_unknown`
- Delete, then Cancel and Save

The amount and calorie boxes are linked live through the existing client mirror in
`web/src/nutrition.ts` — the preview never decides what is stored, the server
recomputes on save, and the comment already at the top of that file continues to
be true.

Saving and deleting both go through Today's existing `act()`, so the calorie
header, the eating window and the macro split refresh together with the list.

## Out of scope

- **Changing which food an entry is.** Delete and log it again; that is a
  different food, not a different amount of this one.
- **Moving an entry to another day.** The time input is an `HH:MM` on the day
  being shown, so the day cannot change. The server already recomputes
  `local_day`, so this stays a small client change if it is ever wanted.
- **Hand-editing macro grams.** It contradicts the snapshot rule above: a macro
  figure typed by hand is not a scaling of anything.

## Tests

Domain, in `nutrition.test.ts`: `scaleNutrition` rounding and a zero factor;
`factorForKcal` on the ordinary case, and throwing on a zero-calorie entry, a
negative figure and a non-finite one.

Route, via `app.inject()` against an in-memory database:

- editing the amount rescales grams, calories and macros
- editing the calories back-solves the amount and scales the macros
- editing the time moves `eaten_at` and leaves the figures alone
- a quick entry's name, calories and time each edit, and both flags survive
- `weight_unknown` survives an amount edit
- sending `quantity` and `kcal` together is a 400
- editing the calories of a zero-calorie entry is a 400
- another user's entry id is a 404 and leaves the row untouched

Web: the linked amount/calorie boxes, and that a `macros_unknown` entry shows no
macro bar and no amount input.

Then look at it on screen with Playwright, at 390x844, against a seeded throwaway
account — the row-as-button change is exactly the kind that type-checks and tests
fine while being unpressable.
