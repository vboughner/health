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
