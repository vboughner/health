-- A quick entry names a food and its calories and nothing else: "Chipotle bowl,
-- 720 cal", typed straight into the day with no food row behind it and no macros
-- anyone wrote down.
--
-- The macro columns cannot be null, so such an entry stores zeros in them. This
-- flag is what stops those zeros reading as measurements — the same distinction
-- weight_unknown draws for bookkeeping grams. Without it, "nobody recorded the
-- macros" and "this food has none" look identical in the row.
ALTER TABLE food_log ADD COLUMN macros_unknown INTEGER NOT NULL DEFAULT 0;
