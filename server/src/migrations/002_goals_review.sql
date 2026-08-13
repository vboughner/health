-- One flag for "I read the plan today", replacing the morning/night pair.
--
-- The original check-in had separate morning and night boxes. That whole section
-- was removed from the UI; reviewing the goals came back as a single button on the
-- goals page, so a single column now says exactly what it means. Either of the old
-- flags counts as a review for days already recorded.

ALTER TABLE daily_entries ADD COLUMN goals_reviewed INTEGER NOT NULL DEFAULT 0;

UPDATE daily_entries
SET goals_reviewed = 1
WHERE reviewed_morning = 1 OR reviewed_night = 1;

ALTER TABLE daily_entries DROP COLUMN reviewed_morning;
ALTER TABLE daily_entries DROP COLUMN reviewed_night;
