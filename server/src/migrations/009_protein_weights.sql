-- Targets from the plan as revised in September 2026: a daily protein range in
-- grams and weights sessions per week.
--
-- Null for every existing period, deliberately. Filling in 90-130 and 2 would re-judge
-- every day since August against goals adopted in late September, which is what
-- effective-dating exists to prevent. The targets are set on Settings, from today.
ALTER TABLE goal_periods ADD COLUMN protein_min_g    INTEGER;
ALTER TABLE goal_periods ADD COLUMN protein_max_g    INTEGER;
ALTER TABLE goal_periods ADD COLUMN weights_per_week INTEGER;

-- Two nested toggles under Diet: Macros, and Protein target under that. Stored flat —
-- nesting is how the Settings screen draws them, not something the server knows.
-- Both on, so nothing disappears from anyone's day on deploy.
ALTER TABLE users ADD COLUMN track_macros  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN track_protein INTEGER NOT NULL DEFAULT 1;
