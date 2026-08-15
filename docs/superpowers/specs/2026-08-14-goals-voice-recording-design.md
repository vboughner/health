# Goals in your own voice

**Date:** 2026-08-14
**Status:** approved, not yet implemented

## The idea

Reading the plan in the morning is hard on tired eyes. Record yourself reading it once,
then play it back from the Goals page instead.

One recording per user, stored as an audio file next to the database. A speaker button
on the Goals title row plays it; a record button at the foot of the page makes it.

## Decisions taken

**Recording needs a secure context.** `getUserMedia` and `MediaRecorder` only work over
HTTPS or on `localhost`, so the record button cannot work from the phone at
`http://<mac's-LAN-IP>:5174`. This was accepted rather than worked around: the feature is
built for the deployed HTTPS site, capture is verified on the Mac at `localhost:5174`, and
the record button says plainly why it cannot record when the mic is unavailable rather
than failing silently. (Chrome on Android could be made to allow it with the
`#unsafely-treat-insecure-origin-as-secure` flag, if that ever becomes useful before
deployment.)

**Stopping a recording does not save it.** Stop offers the take back for review with Save
and Discard. Nothing reaches the server until Save, so a fumbled read costs nothing and
the existing recording stays untouched.

**Playback is a play/stop toggle**, not pause/resume and not a scrubber. The Goals page is
for reading; a permanent player bar across the top of it is a worse trade than restarting
a recording you interrupted.

**The audio is a file on disk, not a BLOB.** A few hundred KB of opus in a database that
gets dumped and copied routinely is the wrong shape, and "an audio file alongside the
database" is what was asked for. The cost is that the nightly SQLite backup no longer
covers everything — see the backup section, which is part of this work rather than a note
for later.

**Upload is a raw body, not multipart.** The server has no `@fastify/multipart` and a
one-field upload does not justify adding it.

**No transcoding.** Chrome on Android produces `audio/webm;codecs=opus`. The mime type is
stored on the row and served back unchanged, against an allowlist.

## Storage

`config.mediaDir`, from `MEDIA_DIR`, defaulting to an `audio/` sibling of `dbPath`:

- locally `data/audio/` — already gitignored, since `data/` is
- production `/home/griljor/health-data/audio/`

Created with `mkdir -p` at startup. `buildApp` takes it in `AppOptions` beside
`sessionSecret`, so tests inject a temp directory.

### Migration `004_goal_recording.sql`

```sql
CREATE TABLE goal_recordings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);
```

`user_id` as the primary key makes one-recording-per-user a schema fact rather than a rule
the routes have to remember.

### Writing a take

Files are named `goals-<userId>-<recordedAt>.<ext>`. A new take is written to a temp name
and `rename`d into place *before* the row is updated, and the previous file is unlinked
only *after*. A failed upload therefore cannot leave a truncated recording where a good
one was, and an extension change (webm to mp4, say) does not orphan the old file.

## Server

### `src/domain/recording.ts` — pure, no I/O

- `normalizeMime(header)` — `audio/webm;codecs=opus` becomes `audio/webm`, lowercased
- `extensionFor(mime)` — allowlist of webm, ogg, mp4, mpeg, wav; `null` for anything else
- `MAX_AUDIO_BYTES` — 10 MB
- `MAX_RECORDING_MS` — 10 minutes
- `recordingFilename(userId, recordedAt, ext)`

### `src/routes/goals.ts`

| Route | Behaviour |
|---|---|
| `GET /api/goals/recording` | `{ recording: {...} \| null }` — metadata only |
| `GET /api/goals/recording/audio` | the bytes, stored mime, `Cache-Control: no-store`; 404 when there is none, and also when the row exists but the file has gone |
| `POST /api/goals/recording?duration_ms=N` | raw audio body; 201 with the new metadata |
| `DELETE /api/goals/recording` | 204; removes the row and the file |

Two details that are easy to get wrong:

- a `/^audio\//` **regex** content-type parser with `parseAs: 'buffer'` handles the upload
  without a multipart dependency, and matches despite the `;codecs=` parameter
- the POST route needs an explicit `bodyLimit`. Fastify's default is 1 MB — a two-minute
  recording clears it, a long one does not, and the failure would look like a mystery.

`no-store` on the audio route is deliberate: the file is small, and the alternative risks
playing back yesterday's take after a re-record.

### Duration comes from the client's timer, not the file

Blobs from `MediaRecorder` routinely carry no duration in the header — `audio.duration`
reads `Infinity`. The recorder counts elapsed milliseconds itself and passes them up as the
query parameter. Do not be tempted to read it off the audio element.

## Web

- `src/recording.ts` — the `MediaRecorder` plumbing and the mic-availability check, kept
  out of the components so they hold UI state and nothing else
- `api.ts` gains `postBlob`, so all HTTP still lives in one file
- `src/components/GoalsPlayer.tsx` — the speaker button on the title row. One `<audio>`
  ref, play/stop toggle, icon swaps to a stop square while playing, resets on `ended`.
  Leaving the Goals tab unmounts it, which stops playback.
- `src/components/GoalsRecorder.tsx` — the foot of the page, four states:
  - **idle** — *Record the goals*, or *Re-record* plus "Recorded 12 Aug, 1:42" and a
    subdued *Delete recording*
  - **recording** — a stop button and a running timer. The page stays scrolled and
    readable, which is the entire point of recording from this screen.
  - **review** — play the take back, Save or Discard
  - **error** — mic blocked, insecure context, upload failed; each said plainly
- `Goals.tsx` fetches the metadata on mount and passes it to both; the recorder calls back
  on save so the speaker button appears without a reload.

Recording auto-stops at `MAX_RECORDING_MS` so a recorder left running cannot hit the size
cap and lose the take at upload time.

The title row becomes a flex row — the heading and, pushed to the right, the speaker
button. It renders nothing at all when there is no recording.

**No Settings toggle.** The speaker exists only when a recording does, so there is nothing
to hide. `FEATURES` is about what the day screen draws; the Goals page has always stayed
readable regardless.

## Backup

The nightly backup is documented in `docs/deployment.md` but not yet live, so this is a
documentation change rather than a change to a running crontab.

A new `scripts/backup.sh` replaces the one-line cron:

1. `sqlite3 app.db ".backup ..."` into `backups/app-<date>.db`
2. `tar -czf backups/audio-<date>.tar.gz` of the audio directory
3. prune both at 14 days

`set -euo pipefail`, so a failed database backup aborts before the audio is touched. The
note in `CLAUDE.md` about setting up the nightly backup is amended to say it covers two
things now.

## Testing

**Domain** — `normalizeMime`, `extensionFor`, the filename builder.

**Routes**, via `app.inject()` against an in-memory database and a temp media directory:

- upload, fetch, delete round trip
- re-recording replaces the row and unlinks the previous file
- a disallowed mime is rejected
- an oversize body is rejected
- 404 when there is no recording, and when the row outlives its file
- **user B gets a 404 for user A's recording** — the one that matters

**Web** — the upload helper.

**On screen**, with Playwright per `CLAUDE.md`: the title row at 390px, checking the
heading and speaker button neither crowd nor clip (`scrollWidth > clientWidth`), and each
recorder state rendering. Several bugs in this repo type-checked and tested fine and were
only caught by looking.

## Known limits

- Deleting a user cascades the `goal_recordings` row but leaves the audio file on disk.
  Worth knowing for the throwaway-account screenshot workflow, not worth a reaper.
- Capture cannot be exercised from the phone until the site is deployed over HTTPS.
