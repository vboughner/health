#!/usr/bin/env bash
#
# Nightly backup: the database and the goals recordings beside it.
#
# Two halves, because the audio deliberately does not live in the database — a
# .backup of app.db alone would look complete and quietly lose every recording.
#
# The database goes first. With set -e a failure there aborts before the audio is
# touched, so a night that half-works leaves the previous complete pair in place
# rather than a fresh half of one and a stale half of the other.

set -euo pipefail

DATA="${HEALTH_DATA:-/home/griljor/health-data}"
BACKUPS="$DATA/backups"
KEEP_DAYS=14
STAMP=$(date +%F)

mkdir -p "$BACKUPS"

# .backup rather than cp: it takes a consistent snapshot of a database in WAL mode
# while the app is still writing to it.
sqlite3 "$DATA/app.db" ".backup '$BACKUPS/app-$STAMP.db'"

if [ -d "$DATA/audio" ]; then
  tar -czf "$BACKUPS/audio-$STAMP.tar.gz" -C "$DATA" audio
fi

find "$BACKUPS" -name 'app-*.db' -mtime +$KEEP_DAYS -delete
find "$BACKUPS" -name 'audio-*.tar.gz' -mtime +$KEEP_DAYS -delete

echo "backed up to $BACKUPS (app-$STAMP.db)"
