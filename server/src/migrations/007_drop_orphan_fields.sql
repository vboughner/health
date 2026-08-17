-- Five fields with server plumbing and nothing on the other end.
--
-- no_meat / no_dairy were check-in boxes removed from the UI as more nagging than
-- useful, leaving columns, patch fields, coercion, types on both sides and seed writes
-- behind them. With the plan now prose each account writes for itself, two fixed
-- columns naming one person's diet rules are the wrong shape for the schema besides.
--
-- The two note columns never had a UI at all: nothing has ever written or shown them.
--
-- source recorded whether exercise calories came from a watch or the MET table. The
-- form stopped asking, so every real row has been 'estimated' since — the split only
-- looked alive because seed-demo fabricated measured rows. Exercise calories are a MET
-- estimate scaled by body weight, and the schema now says so. The consequence is that
-- POST /log/exercise can no longer be given a calorie figure, so needing a weight on
-- file is not escapable and its 400 stops offering an alternative that is gone.
--
-- SQLite drops a column-level CHECK along with its column, so source needs no rebuild.
ALTER TABLE daily_entries DROP COLUMN no_meat;
ALTER TABLE daily_entries DROP COLUMN no_dairy;
ALTER TABLE daily_entries DROP COLUMN note;
ALTER TABLE exercise_log  DROP COLUMN note;
ALTER TABLE exercise_log  DROP COLUMN source;
