-- Initial schema.
--
-- Every table carries user_id. There is one user today, but isolation is enforced in
-- queries from the start so adding accounts later is not a rewrite.
--
-- Timestamps are UTC epoch milliseconds. Anything that rolls up by day also stores a
-- denormalized local_day (YYYY-MM-DD) computed in the user's timezone, so day queries
-- are an indexed equality check and the 7pm cutoff is evaluated in local time.

CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  daily_kcal_budget INTEGER NOT NULL DEFAULT 2400,
  daily_burn_target INTEGER NOT NULL DEFAULT 960,
  window_start      TEXT NOT NULL DEFAULT '09:00',
  window_end        TEXT NOT NULL DEFAULT '19:00',
  created_at        INTEGER NOT NULL
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Foods are a cache, not a log. user_id NULL means a shared entry pulled from USDA;
-- a set user_id means a food this user typed in by hand.
CREATE TABLE foods (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('usda', 'manual')),
  source_id       TEXT,
  name            TEXT NOT NULL,
  brand           TEXT,
  serving_desc    TEXT,
  serving_grams   REAL,
  kcal_per_100g   REAL NOT NULL,
  protein_g       REAL NOT NULL DEFAULT 0,  -- per 100 g
  fat_g           REAL NOT NULL DEFAULT 0,  -- per 100 g
  carb_g          REAL NOT NULL DEFAULT 0,  -- per 100 g
  added_sugar_g   REAL,                     -- per 100 g, NULL when unknown
  sodium_mg       REAL,                     -- per 100 g, NULL when unknown
  ingredients     TEXT,
  processed_flags TEXT NOT NULL DEFAULT '[]',  -- JSON array of human-readable reasons
  created_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_foods_source ON foods(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_foods_name ON foods(name);

-- Calories and macros are SNAPSHOTTED here at log time. Re-caching a food from USDA
-- later must never rewrite what a past day says you ate.
CREATE TABLE food_log (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id   INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  food_name TEXT NOT NULL,
  eaten_at  INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  quantity  REAL NOT NULL,
  unit      TEXT NOT NULL,
  grams     REAL NOT NULL,
  kcal      REAL NOT NULL,
  protein_g REAL NOT NULL,
  fat_g     REAL NOT NULL,
  carb_g    REAL NOT NULL
);

CREATE INDEX idx_food_log_day ON food_log(user_id, local_day);
CREATE INDEX idx_food_log_food ON food_log(user_id, food_id);

CREATE TABLE exercise_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_day  TEXT NOT NULL,
  logged_at  INTEGER NOT NULL,
  activity   TEXT NOT NULL,
  minutes    REAL NOT NULL,
  kcal       REAL NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('estimated', 'measured')),
  note       TEXT
);

CREATE INDEX idx_exercise_log_day ON exercise_log(user_id, local_day);

-- One row per user per day: weight, sleep, and the check-in boxes that are not
-- derivable from the logs. "Done eating by 7pm" is deliberately absent — it comes
-- from the last food_log entry of the day.
CREATE TABLE daily_entries (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_day        TEXT NOT NULL,
  weight_lb        REAL,
  sleep_start      INTEGER,   -- epoch ms
  sleep_end        INTEGER,   -- epoch ms
  reviewed_morning INTEGER NOT NULL DEFAULT 0,
  reviewed_night   INTEGER NOT NULL DEFAULT 0,
  no_meat          INTEGER NOT NULL DEFAULT 0,
  no_dairy         INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  updated_at       INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_daily_entries_day ON daily_entries(user_id, local_day);
