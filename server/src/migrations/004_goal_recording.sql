-- The plan read aloud in your own voice, for mornings when reading it is more than
-- tired eyes want to do.
--
-- One row per user, which is why user_id is the primary key rather than a foreign key
-- sitting beside an id of its own: re-recording replaces, it never accumulates, and
-- saying that in the schema means no route has to remember it.
--
-- The audio itself is a file in MEDIA_DIR, beside the database rather than inside it.
-- A few hundred KB of opus in a table that gets dumped and copied nightly is the wrong
-- shape; what is kept here is where the file is and what is in it. The cost is that the
-- database backup no longer covers everything, which is why scripts/backup.sh exists.
--
-- duration_ms comes from the recorder's own clock rather than from the file. Blobs from
-- MediaRecorder routinely carry no duration in the header, and reading it back off an
-- <audio> element gives Infinity.
CREATE TABLE goal_recordings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);
