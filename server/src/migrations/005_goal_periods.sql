-- The goal numbers become effective-dated, and move off users entirely.
--
-- They were four columns read live by summary and trends, which meant editing them
-- rewrote the past: widening the eating window retroactively un-violated every earlier
-- day, and lowering the budget un-passed them. That is right for fixing a typo and
-- wrong for a real schedule change, so each day is now judged by the period covering
-- it and the edit says which of the two it meant.
--
-- goal_periods is the only store. Keeping the columns as a live copy beside a history
-- would be two sources of truth for the same four numbers.
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

-- Seed one period per existing account from the columns about to be dropped.
--
-- effective_from is the UTC day of created_at, not the local one: a .sql migration
-- cannot resolve an IANA timezone. Being a day out costs nothing, because this is the
-- earliest period and goalsForDay falls back to the earliest for anything before it.
INSERT INTO goal_periods (user_id, effective_from, kcal_budget, burn_target, window_start, window_end)
SELECT id,
       date(created_at / 1000, 'unixepoch'),
       daily_kcal_budget,
       daily_burn_target,
       window_start,
       window_end
FROM users;

ALTER TABLE users DROP COLUMN daily_kcal_budget;
ALTER TABLE users DROP COLUMN daily_burn_target;
ALTER TABLE users DROP COLUMN window_start;
ALTER TABLE users DROP COLUMN window_end;
