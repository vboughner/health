-- A food entered by hand may have a serving defined by its calories rather than by
-- its weight: "one bowl is 320 cal", off a label or a guess, with no gram figure
-- anyone ever put on a scale.
--
-- Such a food is still stored per 100 g like every other, with serving_grams set to
-- 100, so all the serving arithmetic is untouched and one serving works out to
-- exactly the calories that were typed. This flag records that those grams are a
-- bookkeeping unit rather than a measurement: nothing displays them, and the food
-- cannot be logged by weight, because the weight is not known.
ALTER TABLE foods ADD COLUMN weight_unknown INTEGER NOT NULL DEFAULT 0;

-- Snapshotted onto the log for the same reason the calories are: what a past entry
-- says it was must not change when the food behind it is edited or re-cached.
ALTER TABLE food_log ADD COLUMN weight_unknown INTEGER NOT NULL DEFAULT 0;
