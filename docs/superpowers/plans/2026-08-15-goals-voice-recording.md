# Goals Voice Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record yourself reading the plan aloud once, then play it back from the Goals page with a speaker button on the title row.

**Architecture:** The browser's `MediaRecorder` captures a take; the raw bytes are POSTed as the request body (no multipart) to a new `/api/goals/recording` route group; the server writes the audio as a file in `MEDIA_DIR` beside the database and keeps one metadata row per user in a new `goal_recordings` table. All mime/extension/limit decisions live in a pure `domain/recording.ts`. The web side splits into media plumbing (`web/src/recording.ts`) and two focused components — a player on the title row, a recorder at the foot of the page.

**Tech Stack:** Fastify 5 + better-sqlite3 (CommonJS, TypeScript), React 19 + Vite (ESM), vitest both sides, hand-rolled inline SVG for icons.

**Spec:** `docs/superpowers/specs/2026-08-14-goals-voice-recording-design.md`

## Global Constraints

- Prettier: 2-space, single quotes, semicolons, **100 columns**. Run `npm run format` before committing.
- `npm run check` (tests + lint + format check) must pass before any commit.
- Routes stay thin: parse, call domain, persist, return. All arithmetic and all classification lives in `server/src/domain/` as pure functions with no I/O.
- All SQL lives in `server/src/store.ts`. Every query filters on `user_id`.
- Never edit an applied migration. This work adds `004_goal_recording.sql` and nothing else.
- The server test suite never touches the network.
- Server tests are type-checked via `server/tsconfig.test.json` — a test that does not compile fails `npm test`.
- `server/` and `web/` must not import from each other. Shared constants are duplicated deliberately, with a comment saying so.
- Amber (`--warn`) is a reserved status colour. Do not use it for anything here.
- `MAX_AUDIO_BYTES` is `10 * 1024 * 1024`. `MAX_RECORDING_MS` is `10 * 60 * 1000`. These two numbers are chosen together — ten minutes of opus is roughly 2.5 MB, so a recording that hits the time cap still uploads. Changing one means rechecking the other.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `server/src/migrations/004_goal_recording.sql` | the `goal_recordings` table |
| `server/src/domain/recording.ts` | mime normalising, extension allowlist, limits, filename building — pure |
| `server/src/__tests__/recording.test.ts` | domain unit tests |
| `server/src/routes/goals.ts` | the four `/api/goals/recording*` routes |
| `server/src/__tests__/goals-route.test.ts` | route integration tests |
| `web/src/recording.ts` | `MediaRecorder` plumbing, mic availability, duration formatting |
| `web/src/__tests__/recording.test.ts` | web unit tests |
| `web/src/components/GoalsPlayer.tsx` | the speaker/stop button on the title row |
| `web/src/components/GoalsRecorder.tsx` | the record/review/save block at the foot of the page |
| `scripts/backup.sh` | nightly database + audio backup |

**Modified**

| Path | Change |
|---|---|
| `server/src/config.ts` | `mediaDir` |
| `server/src/store.ts` | `getGoalRecording` / `putGoalRecording` / `deleteGoalRecording` |
| `server/src/app.ts` | `mediaDir` in `AppOptions`, the `audio/*` content-type parser, register the routes |
| `server/src/main.ts` | pass `mediaDir`, log it |
| `server/src/__tests__/helpers.ts` | `testMediaDir()`, `testApp` takes it |
| `server/src/__tests__/db.test.ts` | store round-trip tests |
| `web/src/api.ts` | `postBlob`, and a shared `toError` so it and `request` do not duplicate error parsing |
| `web/src/types.ts` | `GoalRecording` |
| `web/src/screens/Goals.tsx` | fetch metadata, render the player and recorder |
| `web/src/styles.css` | `.title-row`, `.btn-icon`, `.recorder*` |
| `docs/deployment.md` | `MEDIA_DIR`, nginx `client_max_body_size`, the new backup script |
| `CLAUDE.md` | the backup note now covers two things; a line about the recording |

---

## Task 1: The recording domain module

Pure functions only. No filesystem, no database, no Fastify.

**Files:**
- Create: `server/src/domain/recording.ts`
- Test: `server/src/__tests__/recording.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MAX_AUDIO_BYTES: number`
  - `MAX_RECORDING_MS: number`
  - `normalizeMime(header: string): string`
  - `extensionFor(mime: string): string | null`
  - `recordingFilename(userId: number, recordedAt: number, ext: string): string`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/recording.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  normalizeMime,
  extensionFor,
  recordingFilename,
} from '../domain/recording';

describe('normalizeMime', () => {
  it('drops the codecs parameter MediaRecorder sends', () => {
    expect(normalizeMime('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('lowercases and trims', () => {
    expect(normalizeMime('  Audio/WEBM ; codecs=opus')).toBe('audio/webm');
  });

  it('leaves a bare type alone', () => {
    expect(normalizeMime('audio/mp4')).toBe('audio/mp4');
  });

  it('gives an empty string back for an empty header', () => {
    expect(normalizeMime('')).toBe('');
  });
});

describe('extensionFor', () => {
  it('accepts what browsers actually record', () => {
    expect(extensionFor('audio/webm')).toBe('webm');
    expect(extensionFor('audio/ogg')).toBe('ogg');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/mpeg')).toBe('mp3');
    expect(extensionFor('audio/wav')).toBe('wav');
  });

  it('normalizes before matching, so a codecs parameter still resolves', () => {
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
  });

  it('refuses anything not on the list', () => {
    expect(extensionFor('audio/flac')).toBeNull();
    expect(extensionFor('application/json')).toBeNull();
    expect(extensionFor('')).toBeNull();
  });

  it('refuses a type that would smuggle a path into the extension', () => {
    expect(extensionFor('audio/../../etc/passwd')).toBeNull();
  });
});

describe('recordingFilename', () => {
  it('carries the user and the timestamp, so a re-record never lands on the old file', () => {
    expect(recordingFilename(7, 1755200000000, 'webm')).toBe('goals-7-1755200000000.webm');
  });
});

describe('the limits', () => {
  // These two are chosen together: ten minutes of opus is nearer 2.5 MB, so a
  // recording that hits the time cap still fits under the size cap and uploads
  // rather than being rejected at the door after you have already read it out.
  it('leaves room for a recording of the maximum length', () => {
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_RECORDING_MS).toBe(10 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```sh
npx vitest run src/__tests__/recording.test.ts --root server
```

Expected: FAIL — `Failed to resolve import "../domain/recording"`.

- [ ] **Step 3: Write the implementation**

Create `server/src/domain/recording.ts`:

```ts
/**
 * What counts as audio we are willing to store, and what to call it on disk.
 *
 * Pure like the rest of domain/: the routes do the writing, this decides the names
 * and the limits.
 */

/**
 * The mime types we accept and the extension each gets.
 *
 * Whatever the browser's MediaRecorder produced is what gets stored — Chrome gives
 * audio/webm, Safari gives audio/mp4 — so this is the set of things a browser might
 * hand us rather than a preference between them. Nothing is transcoded.
 */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/**
 * 10 MB. A runaway guard rather than a real ceiling: ten minutes of opus is nearer
 * 2.5 MB, so a recording that runs to MAX_RECORDING_MS still fits comfortably.
 * The two limits were picked together — moving one means checking the other.
 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Ten minutes. The plan takes about two to read aloud. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

/**
 * A Content-Type without its parameters, lowercased.
 *
 * MediaRecorder sends `audio/webm;codecs=opus`; what we store and serve back is
 * `audio/webm`. Keeping the parameter would mean the allowlist had to enumerate
 * codec spellings it has no opinion about.
 */
export function normalizeMime(header: string): string {
  return header.split(';')[0].trim().toLowerCase();
}

/**
 * The extension for an accepted mime type, or null for anything else.
 *
 * Returning null rather than a default is what keeps the extension safe to
 * concatenate into a filename: it can only ever be one of the strings above.
 */
export function extensionFor(mime: string): string | null {
  const normalized = normalizeMime(mime);
  // hasOwnProperty rather than a bare lookup: `constructor` and friends are on every
  // object's prototype, and a truthy hit there would put a function where the
  // extension goes.
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, normalized)
    ? EXTENSIONS[normalized]
    : null;
}

/**
 * Names carry the timestamp so a new take never writes over the file the row still
 * points at. The new one lands beside the old, and the old is removed only once the
 * row has moved — which is what makes a failed upload harmless.
 */
export function recordingFilename(userId: number, recordedAt: number, ext: string): string {
  return `goals-${userId}-${recordedAt}.${ext}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```sh
npx vitest run src/__tests__/recording.test.ts --root server
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Format, lint, commit**

```sh
npm run format --prefix server && npm run lint --prefix server
git add server/src/domain/recording.ts server/src/__tests__/recording.test.ts
git commit -m "Decide what audio we will store and what to call it"
```

---

## Task 2: Schema, config and store

**Files:**
- Create: `server/src/migrations/004_goal_recording.sql`
- Modify: `server/src/config.ts`, `server/src/store.ts`
- Test: `server/src/__tests__/db.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `interface GoalRecording { filename: string; mime: string; bytes: number; duration_ms: number; recorded_at: number }`
  - `getGoalRecording(db: Db, userId: number): GoalRecording | undefined`
  - `putGoalRecording(db: Db, userId: number, rec: GoalRecording): GoalRecording | undefined` — returns the row it replaced, so the caller knows which file just became unreferenced
  - `deleteGoalRecording(db: Db, userId: number): GoalRecording | undefined` — likewise
  - `config.mediaDir: string`

- [ ] **Step 1: Write the failing test**

Append to `server/src/__tests__/db.test.ts`. Check the top of that file first: it already imports `describe`, `it`, `expect` from vitest and has a `testDb()`-style setup — reuse whatever is there rather than adding a second import block.

```ts
describe('goal recordings', () => {
  function row(overrides: Partial<GoalRecording> = {}): GoalRecording {
    return {
      filename: 'goals-1-1755200000000.webm',
      mime: 'audio/webm',
      bytes: 240_000,
      duration_ms: 102_000,
      recorded_at: 1755200000000,
      ...overrides,
    };
  }

  it('stores and reads back a recording', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');

    expect(getGoalRecording(db, user.id)).toBeUndefined();

    putGoalRecording(db, user.id, row());
    expect(getGoalRecording(db, user.id)).toEqual(row());
  });

  it('replaces rather than accumulates, and hands back the row it replaced', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');

    putGoalRecording(db, user.id, row());
    const previous = putGoalRecording(
      db,
      user.id,
      row({ filename: 'goals-1-1755300000000.m4a', mime: 'audio/mp4', recorded_at: 1755300000000 }),
    );

    // The caller needs the old filename to delete the file it left behind.
    expect(previous?.filename).toBe('goals-1-1755200000000.webm');
    expect(getGoalRecording(db, user.id)?.mime).toBe('audio/mp4');
    expect(db.prepare('SELECT COUNT(*) AS n FROM goal_recordings').get()).toEqual({ n: 1 });
  });

  it('deleting returns the row so its file can go too', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');

    expect(deleteGoalRecording(db, user.id)).toBeUndefined();

    putGoalRecording(db, user.id, row());
    expect(deleteGoalRecording(db, user.id)?.filename).toBe('goals-1-1755200000000.webm');
    expect(getGoalRecording(db, user.id)).toBeUndefined();
  });

  it('keeps one user out of another user recording', async () => {
    const db = testDb();
    const van = await createUser(db, 'van', 'correct-horse');
    const other = await createUser(db, 'other', 'correct-horse');

    putGoalRecording(db, van.id, row());

    expect(getGoalRecording(db, other.id)).toBeUndefined();
    expect(deleteGoalRecording(db, other.id)).toBeUndefined();
    // And the other user's attempt did not disturb the real one.
    expect(getGoalRecording(db, van.id)).toEqual(row());
  });

  it('goes when the user does', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');
    putGoalRecording(db, user.id, row());

    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    expect(getGoalRecording(db, user.id)).toBeUndefined();
  });
});
```

Add to that file's imports:

```ts
import {
  getGoalRecording,
  putGoalRecording,
  deleteGoalRecording,
  type GoalRecording,
} from '../store';
import { createUser } from '../auth';
```

(If `createUser` or `testDb` is already imported there, do not import it twice.)

- [ ] **Step 2: Run the test and watch it fail**

```sh
npx vitest run src/__tests__/db.test.ts --root server
```

Expected: FAIL — `getGoalRecording is not exported`.

- [ ] **Step 3: Add the migration**

Create `server/src/migrations/004_goal_recording.sql`:

```sql
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
```

- [ ] **Step 4: Add the store functions**

Append to `server/src/store.ts`:

```ts
export interface GoalRecording {
  filename: string;
  mime: string;
  bytes: number;
  duration_ms: number;
  recorded_at: number;
}

export function getGoalRecording(db: Db, userId: number): GoalRecording | undefined {
  return db
    .prepare(
      `SELECT filename, mime, bytes, duration_ms, recorded_at
         FROM goal_recordings
        WHERE user_id = ?`,
    )
    .get(userId) as GoalRecording | undefined;
}

/**
 * Writes the row and returns whatever it replaced.
 *
 * The return value is the point: the caller is holding a file it has just written and
 * needs to know which older file is now unreferenced. Reading it here, inside the same
 * call that overwrites it, is the only moment both are knowable.
 */
export function putGoalRecording(
  db: Db,
  userId: number,
  rec: GoalRecording,
): GoalRecording | undefined {
  const previous = getGoalRecording(db, userId);

  db.prepare(
    `INSERT INTO goal_recordings (user_id, filename, mime, bytes, duration_ms, recorded_at)
     VALUES (@user_id, @filename, @mime, @bytes, @duration_ms, @recorded_at)
     ON CONFLICT(user_id) DO UPDATE SET
       filename    = excluded.filename,
       mime        = excluded.mime,
       bytes       = excluded.bytes,
       duration_ms = excluded.duration_ms,
       recorded_at = excluded.recorded_at`,
  ).run({ user_id: userId, ...rec });

  return previous;
}

/** Returns the row that was removed, so its file can be removed too. */
export function deleteGoalRecording(db: Db, userId: number): GoalRecording | undefined {
  const previous = getGoalRecording(db, userId);
  if (previous) db.prepare('DELETE FROM goal_recordings WHERE user_id = ?').run(userId);
  return previous;
}
```

- [ ] **Step 5: Add `mediaDir` to config**

In `server/src/config.ts`, the `dbPath` is currently computed inline inside the exported object. Lift it out so the media directory can default to a sibling of it. Replace the bottom of the file (from `export const config` onwards) with:

```ts
const dbPath = resolveDbPath(process.env.DB_PATH ?? './data/app.db');

/**
 * Where recordings are written. Defaults to an `audio/` sibling of the database, so
 * the two halves of the user's data travel together — locally `data/audio/`, which
 * `data/` in .gitignore already covers, and in production
 * /home/griljor/health-data/audio/ next to app.db.
 */
function resolveMediaDir(): string {
  const raw = process.env.MEDIA_DIR;
  if (!raw) return path.join(path.dirname(dbPath), 'audio');
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4300),
  dbPath,
  mediaDir: resolveMediaDir(),
  sessionSecret: requireSessionSecret(),
  usdaApiKey: process.env.USDA_API_KEY ?? '',
};
```

- [ ] **Step 6: Run the tests and watch them pass**

```sh
npx vitest run src/__tests__/db.test.ts --root server
```

Expected: PASS. The migration runner picks `004_goal_recording.sql` up automatically — every test database is built by running every migration in filename order, so there is nothing to register.

- [ ] **Step 7: Commit**

```sh
npm run format --prefix server && npm run lint --prefix server
git add server/src/migrations/004_goal_recording.sql server/src/store.ts \
        server/src/config.ts server/src/__tests__/db.test.ts
git commit -m "Give each user a place to keep one recording of the goals"
```

---

## Task 3: The routes

**Files:**
- Create: `server/src/routes/goals.ts`, `server/src/__tests__/goals-route.test.ts`
- Modify: `server/src/app.ts`, `server/src/main.ts`, `server/src/__tests__/helpers.ts`

**Interfaces:**
- Consumes: `MAX_AUDIO_BYTES`, `normalizeMime`, `extensionFor`, `recordingFilename` (Task 1); `getGoalRecording`, `putGoalRecording`, `deleteGoalRecording`, `GoalRecording` (Task 2); `config.mediaDir` (Task 2)
- Produces:
  - `registerGoalRoutes(app: FastifyInstance, opts: AppOptions): void`
  - `AppOptions` gains `mediaDir: string`
  - `testMediaDir(): string` in helpers; `testApp(db, usda?, mediaDir?)`
  - The wire format the web side consumes:
    `{ recording: { mime: string; bytes: number; duration_ms: number; recorded_at: number } | null }`

- [ ] **Step 1: Extend the test helpers**

In `server/src/__tests__/helpers.ts`, add to the imports at the top:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
```

and add, next to `testDb`:

```ts
/**
 * A throwaway directory for a test's audio files. Each call gets its own, so two
 * suites writing a recording for user 1 cannot collide.
 */
export function testMediaDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'health-media-'));
}
```

and change `testApp` to take one:

```ts
export function testApp(
  db: Db,
  usda: UsdaClient = nullUsdaClient,
  mediaDir: string = testMediaDir(),
): FastifyInstance {
  return buildApp({
    db,
    usda,
    mediaDir,
    sessionSecret: TEST_SECRET,
    isProduction: false,
    logger: false,
  });
}
```

Every existing caller passes one or two arguments and is unaffected.

- [ ] **Step 2: Write the failing test**

Create `server/src/__tests__/goals-route.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { testDb, testApp, testMediaDir, loginAs, type Res } from './helpers';
import { nullUsdaClient } from '../usda';
import { MAX_AUDIO_BYTES } from '../domain/recording';

/** A small stand-in for a take. The bytes are never decoded, only stored. */
const AUDIO = Buffer.from('fake-opus-bytes');

async function setup() {
  const db = testDb();
  const mediaDir = testMediaDir();
  const app = testApp(db, nullUsdaClient, mediaDir);
  const van = await loginAs(app, db, 'van');
  return { db, app, mediaDir, van };
}

function upload(
  app: ReturnType<typeof testApp>,
  cookie: string,
  body: Buffer,
  contentType = 'audio/webm;codecs=opus',
  durationMs = 102_000,
): Res {
  return app.inject({
    method: 'POST',
    url: `/api/goals/recording?duration_ms=${durationMs}`,
    headers: { cookie, 'content-type': contentType },
    payload: body,
  });
}

describe('GET /api/goals/recording', () => {
  it('says there is none before anything is recorded', async () => {
    const { app, van } = await setup();

    const res = await app.inject({
      method: 'GET',
      url: '/api/goals/recording',
      headers: { cookie: van.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recording: null });
  });

  it('needs a session', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/goals/recording' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/goals/recording', () => {
  it('stores the audio and describes it back', async () => {
    const { app, mediaDir, van } = await setup();

    const res = await upload(app, van.cookie, AUDIO);

    expect(res.statusCode).toBe(201);
    const { recording } = res.json();
    // The codecs parameter is dropped; the family is what is stored.
    expect(recording.mime).toBe('audio/webm');
    expect(recording.bytes).toBe(AUDIO.length);
    expect(recording.duration_ms).toBe(102_000);
    expect(recording.recorded_at).toBeGreaterThan(0);

    // The filename is deliberately not in the response — the page never needs it.
    expect(recording.filename).toBeUndefined();

    const files = fs.readdirSync(mediaDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^goals-\d+-\d+\.webm$/);
    expect(fs.readFileSync(path.join(mediaDir, files[0]))).toEqual(AUDIO);
  });

  it('leaves no .part file behind', async () => {
    const { app, mediaDir, van } = await setup();
    await upload(app, van.cookie, AUDIO);
    expect(fs.readdirSync(mediaDir).some((f) => f.endsWith('.part'))).toBe(false);
  });

  it('replaces the previous take and removes the file it left', async () => {
    const { app, mediaDir, van } = await setup();

    await upload(app, van.cookie, AUDIO);
    const first = fs.readdirSync(mediaDir)[0];

    // A different container, to prove the extension change does not orphan anything.
    await upload(app, van.cookie, Buffer.from('a-second-take'), 'audio/mp4', 60_000);

    const files = fs.readdirSync(mediaDir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe(first);
    expect(files[0]).toMatch(/\.m4a$/);
  });

  it('refuses a container we cannot store', async () => {
    const { app, van } = await setup();
    const res = await upload(app, van.cookie, AUDIO, 'audio/flac');
    expect(res.statusCode).toBe(415);
  });

  it('refuses a body that is not audio at all', async () => {
    const { app, van } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/goals/recording?duration_ms=1000',
      headers: { cookie: van.cookie, 'content-type': 'application/json' },
      payload: { not: 'audio' },
    });
    expect(res.statusCode).toBe(415);
  });

  it('refuses an empty body', async () => {
    const { app, van } = await setup();
    const res = await upload(app, van.cookie, Buffer.alloc(0));
    expect(res.statusCode).toBe(400);
  });

  it('refuses a recording without a believable duration', async () => {
    const { app, van } = await setup();
    expect((await upload(app, van.cookie, AUDIO, 'audio/webm', 0)).statusCode).toBe(400);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/goals/recording',
      headers: { cookie: van.cookie, 'content-type': 'audio/webm' },
      payload: AUDIO,
    });
    expect(missing.statusCode).toBe(400);
  });

  it('refuses a recording over the size cap', async () => {
    const { app, mediaDir, van } = await setup();

    const huge = Buffer.alloc(MAX_AUDIO_BYTES + 1, 0x61);
    const res = await upload(app, van.cookie, huge);

    expect(res.statusCode).toBe(413);
    // Nothing was written, not even partially.
    expect(fs.readdirSync(mediaDir)).toHaveLength(0);
  });

  it('needs a session', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/goals/recording?duration_ms=1000',
      headers: { 'content-type': 'audio/webm' },
      payload: AUDIO,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/goals/recording/audio', () => {
  it('serves the bytes back with the type they were stored as', async () => {
    const { app, van } = await setup();
    await upload(app, van.cookie, AUDIO);

    const res = await app.inject({
      method: 'GET',
      url: '/api/goals/recording/audio',
      headers: { cookie: van.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/webm');
    // Never cached: a re-record must not play yesterday's take back.
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload).toEqual(AUDIO);
  });

  it('is a 404 when nothing has been recorded', async () => {
    const { app, van } = await setup();
    const res = await app.inject({
      method: 'GET',
      url: '/api/goals/recording/audio',
      headers: { cookie: van.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('is a 404, not a 500, when the row outlives its file', async () => {
    const { app, mediaDir, van } = await setup();
    await upload(app, van.cookie, AUDIO);

    // What a database restored without its audio directory looks like.
    for (const f of fs.readdirSync(mediaDir)) fs.unlinkSync(path.join(mediaDir, f));

    const res = await app.inject({
      method: 'GET',
      url: '/api/goals/recording/audio',
      headers: { cookie: van.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/goals/recording', () => {
  it('removes the row and the file', async () => {
    const { app, mediaDir, van } = await setup();
    await upload(app, van.cookie, AUDIO);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/goals/recording',
      headers: { cookie: van.cookie },
    });

    expect(res.statusCode).toBe(204);
    expect(fs.readdirSync(mediaDir)).toHaveLength(0);

    const after = await app.inject({
      method: 'GET',
      url: '/api/goals/recording',
      headers: { cookie: van.cookie },
    });
    expect(after.json()).toEqual({ recording: null });
  });

  it('is a 404 when there was nothing to delete', async () => {
    const { app, van } = await setup();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/goals/recording',
      headers: { cookie: van.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('one user cannot reach another user recording', () => {
  it('hides it from every route', async () => {
    const { db, app, mediaDir, van } = await setup();
    const other = await loginAs(app, db, 'other');

    await upload(app, van.cookie, AUDIO);

    const metadata = await app.inject({
      method: 'GET',
      url: '/api/goals/recording',
      headers: { cookie: other.cookie },
    });
    expect(metadata.json()).toEqual({ recording: null });

    const audio = await app.inject({
      method: 'GET',
      url: '/api/goals/recording/audio',
      headers: { cookie: other.cookie },
    });
    expect(audio.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/goals/recording',
      headers: { cookie: other.cookie },
    });
    expect(removed.statusCode).toBe(404);

    // And after all that, the real one is untouched.
    expect(fs.readdirSync(mediaDir)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

```sh
npx vitest run src/__tests__/goals-route.test.ts --root server
```

Expected: FAIL — `testMediaDir` resolves but every route 404s, because they do not exist yet.

- [ ] **Step 4: Write the routes**

Create `server/src/routes/goals.ts`:

```ts
import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import {
  MAX_AUDIO_BYTES,
  normalizeMime,
  extensionFor,
  recordingFilename,
} from '../domain/recording';
import {
  getGoalRecording,
  putGoalRecording,
  deleteGoalRecording,
  type GoalRecording,
} from '../store';

/**
 * What the page is told about a recording. Everything except the filename, which is
 * ours: it says nothing the page needs and everything a crafted path would like.
 */
function publicView(rec: GoalRecording) {
  return {
    mime: rec.mime,
    bytes: rec.bytes,
    duration_ms: rec.duration_ms,
    recorded_at: rec.recorded_at,
  };
}

/** A file that has already gone is the state we were aiming for. */
function removeQuietly(app: FastifyInstance, dir: string, filename: string): void {
  try {
    fs.unlinkSync(path.join(dir, filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    // Worth knowing about — it means the media directory is filling with files
    // nothing points at — but not worth failing a request the user asked for.
    app.log.warn({ err, filename }, 'could not remove an old goals recording');
  }
}

export function registerGoalRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.get('/goals/recording', { preHandler: app.requireUser }, async (request) => {
    const rec = getGoalRecording(opts.db, request.user!.id);
    return { recording: rec ? publicView(rec) : null };
  });

  app.get('/goals/recording/audio', { preHandler: app.requireUser }, async (request, reply) => {
    const rec = getGoalRecording(opts.db, request.user!.id);
    if (!rec) return reply.code(404).send({ error: 'No recording' });

    const file = path.join(opts.mediaDir, rec.filename);

    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      // A row outliving its file means the media directory moved, or a database was
      // restored without one. Saying "not found" is truer than a 500, and the page
      // can offer to record again.
      return reply.code(404).send({ error: 'The recording file is missing' });
    }

    return reply
      .type(rec.mime)
      // Never cached. The file is small, and the alternative is hearing yesterday's
      // take after re-recording.
      .header('Cache-Control', 'no-store')
      .header('Content-Length', String(size))
      .send(fs.createReadStream(file));
  });

  app.post<{ Querystring: { duration_ms?: string } }>(
    '/goals/recording',
    // Fastify's default body limit is 1 MB, which a two-minute recording clears and a
    // long one does not. Without this the failure arrives as a mystery 413 from the
    // framework rather than from the check below.
    { preHandler: app.requireUser, bodyLimit: MAX_AUDIO_BYTES },
    async (request, reply) => {
      const userId = request.user!.id;
      const body = request.body;

      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.code(400).send({ error: 'Expected audio in the request body' });
      }
      if (body.length > MAX_AUDIO_BYTES) {
        return reply.code(413).send({ error: 'That recording is too long to store' });
      }

      const mime = normalizeMime(request.headers['content-type'] ?? '');
      const ext = extensionFor(mime);
      if (!ext) {
        return reply.code(415).send({ error: `Cannot store ${mime || 'that kind of'} audio` });
      }

      // From the recorder's own clock, not from the file: blobs out of MediaRecorder
      // routinely carry no duration in their header.
      const durationMs = Number(request.query.duration_ms);
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return reply.code(400).send({ error: 'Expected a positive duration_ms' });
      }

      const recordedAt = Date.now();
      const filename = recordingFilename(userId, recordedAt, ext);
      const finalPath = path.join(opts.mediaDir, filename);

      // Written under a temp name and renamed into place, so a write that dies part
      // way through cannot leave a truncated file where a good recording was.
      fs.mkdirSync(opts.mediaDir, { recursive: true });
      fs.writeFileSync(`${finalPath}.part`, body);
      fs.renameSync(`${finalPath}.part`, finalPath);

      const previous = putGoalRecording(opts.db, userId, {
        filename,
        mime,
        bytes: body.length,
        duration_ms: Math.round(durationMs),
        recorded_at: recordedAt,
      });

      // Only now, with the row pointing at the new file, is the old one unreferenced.
      // Two takes inside the same millisecond would share a name; the guard keeps that
      // from deleting the file just written.
      if (previous && previous.filename !== filename) {
        removeQuietly(app, opts.mediaDir, previous.filename);
      }

      return reply.code(201).send({
        recording: {
          mime,
          bytes: body.length,
          duration_ms: Math.round(durationMs),
          recorded_at: recordedAt,
        },
      });
    },
  );

  app.delete('/goals/recording', { preHandler: app.requireUser }, async (request, reply) => {
    const previous = deleteGoalRecording(opts.db, request.user!.id);
    if (!previous) return reply.code(404).send({ error: 'No recording' });

    removeQuietly(app, opts.mediaDir, previous.filename);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 5: Wire it into the app**

In `server/src/app.ts`, add the import beside the others:

```ts
import { registerGoalRoutes } from './routes/goals';
```

add `mediaDir` to `AppOptions`:

```ts
export interface AppOptions {
  db: Db;
  usda: UsdaClient;
  /** Where goals recordings are written. See config.mediaDir. */
  mediaDir: string;
  sessionSecret: string;
  isProduction: boolean;
  logger?: boolean;
}
```

add the content-type parser immediately after `app.register(cookie, ...)`:

```ts
  // A recording is POSTed as the request body with the container's own content type —
  // audio/webm;codecs=opus and friends. A regex parser catches the whole family without
  // enumerating codec spellings, and buffers the bytes rather than trying to parse
  // them. The per-route bodyLimit in routes/goals.ts is what bounds it.
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
```

and register the routes inside the `/api` plugin, after `registerTrendRoutes(api, opts)`:

```ts
      registerGoalRoutes(api, opts);
```

- [ ] **Step 6: Wire it into main**

In `server/src/main.ts`, add `mediaDir: config.mediaDir,` to the `buildApp` call (beside `usda`), and a log line after the database one:

```ts
  app.log.info(`recordings: ${config.mediaDir}`);
```

- [ ] **Step 7: Run the tests and watch them pass**

```sh
npx vitest run src/__tests__/goals-route.test.ts --root server
```

Expected: PASS, 17 tests.

Then the whole server suite, which also type-checks:

```sh
npm test --prefix server
```

Expected: PASS. If `testApp` calls elsewhere fail to compile, they are passing arguments positionally in the wrong order — check them against the new signature.

- [ ] **Step 8: Commit**

```sh
npm run format --prefix server && npm run lint --prefix server
git add server/src/routes/goals.ts server/src/app.ts server/src/main.ts \
        server/src/__tests__/helpers.ts server/src/__tests__/goals-route.test.ts
git commit -m "Serve, store and replace a recording of the goals"
```

---

## Task 4: The web side's media plumbing

Everything that touches `MediaRecorder`, `getUserMedia` or raw uploads, kept out of the components so they hold UI state and nothing else.

**Files:**
- Create: `web/src/recording.ts`, `web/src/__tests__/recording.test.ts`
- Modify: `web/src/api.ts`, `web/src/types.ts`

**Interfaces:**
- Consumes: the wire format from Task 3
- Produces:
  - `GoalRecording` in `web/src/types.ts`: `{ mime: string; bytes: number; duration_ms: number; recorded_at: number }`
  - `api.postBlob<T>(path: string, blob: Blob): Promise<T>`
  - `MAX_RECORDING_MS: number`
  - `micUnavailableReason(): string | null`
  - `interface Take { blob: Blob; durationMs: number }`
  - `interface Recorder { stop(): Promise<Take>; cancel(): void }`
  - `startRecording(): Promise<Recorder>`
  - `saveRecording(take: Take): Promise<{ recording: GoalRecording }>`
  - `formatDuration(ms: number): string`

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/recording.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDuration, micUnavailableReason, saveRecording } from '../recording';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatDuration', () => {
  it('reads as a clock, not as a number of seconds', () => {
    expect(formatDuration(102_000)).toBe('1:42');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('rounds to the nearest second rather than truncating', () => {
    expect(formatDuration(1_600)).toBe('0:02');
  });

  it('never shows a negative or a broken clock', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});

describe('micUnavailableReason', () => {
  it('is null when the browser will hand over a microphone', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve() } });
    vi.stubGlobal('isSecureContext', true);
    expect(micUnavailableReason()).toBeNull();
  });

  it('blames the connection when the page is not secure', () => {
    // What an insecure origin actually looks like: mediaDevices is simply absent.
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('isSecureContext', false);
    expect(micUnavailableReason()).toMatch(/secure/i);
  });

  it('blames the browser when the page is secure but there is no API', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('isSecureContext', true);
    expect(micUnavailableReason()).toMatch(/browser/i);
  });
});

describe('saveRecording', () => {
  it('posts the bytes with the blob type and the measured duration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ recording: { mime: 'audio/webm' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const blob = new Blob(['bytes'], { type: 'audio/webm;codecs=opus' });
    await saveRecording({ blob, durationMs: 102_400 });

    const [url, init] = fetchMock.mock.calls[0];
    // Rounded, because the server wants an integer and the clock gives fractions.
    expect(url).toBe('/api/goals/recording?duration_ms=102400');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('audio/webm;codecs=opus');
    expect(init.body).toBe(blob);
  });

  it('turns a refusal into the message the server gave', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Cannot store audio/flac audio' }), {
          status: 415,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      saveRecording({ blob: new Blob(['x'], { type: 'audio/flac' }), durationMs: 1000 }),
    ).rejects.toThrow('Cannot store audio/flac audio');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```sh
npx vitest run src/__tests__/recording.test.ts --root web
```

Expected: FAIL — `Failed to resolve import "../recording"`.

- [ ] **Step 3: Add the type**

Append to `web/src/types.ts`:

```ts
/**
 * The goals read aloud. Metadata only — the audio itself is fetched as a URL by the
 * player rather than carried through here.
 */
export interface GoalRecording {
  mime: string;
  bytes: number;
  duration_ms: number;
  recorded_at: number;
}
```

- [ ] **Step 4: Add `postBlob` to the api module**

In `web/src/api.ts`, lift the error parsing out of `request` so both callers share it, then add `postBlob`. Replace the body of the file between the `ApiError` class and the `export const api` object with:

```ts
/**
 * Everything the two request shapes do once the response is back: raise on a failure,
 * and hand a 204 back as nothing. Pulled out because the raw-body upload needs exactly
 * this and has nothing else in common with `request`.
 */
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = await res.json();
      if (json?.error) message = json.error;
    } catch {
      // Non-JSON error body (nginx 502, for instance) — keep the generic message.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return unwrap<T>(res);
}

/**
 * Posts raw bytes rather than JSON: the body *is* the file.
 *
 * The blob's own type becomes the Content-Type, which is how the server learns whether
 * it was handed webm or mp4 without the page having to guess on the browser's behalf.
 */
async function postBlob<T>(path: string, blob: Blob): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });

  return unwrap<T>(res);
}
```

and add `postBlob` to the exported object:

```ts
export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  postBlob,

  login: (username: string, password: string) =>
    request<{ user: User }>('POST', '/auth/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  me: () => request<{ user: User }>('GET', '/auth/me'),
};
```

- [ ] **Step 5: Write the recording module**

Create `web/src/recording.ts`:

```ts
/**
 * Capturing the microphone and shipping the result.
 *
 * All the media plumbing lives here so the components hold UI state and nothing else.
 * Nothing in this file renders, and nothing that renders talks to MediaRecorder.
 */

import { api } from './api';
import type { GoalRecording } from './types';

/**
 * Ten minutes. Deliberately the same number as MAX_RECORDING_MS in the server's
 * domain/recording.ts — the two packages must not import each other, so it is written
 * twice on purpose. Change one and change the other.
 */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

export interface Take {
  blob: Blob;
  /**
   * Counted here, by the clock, rather than read back off the blob. Recordings out of
   * MediaRecorder routinely carry no duration in their header and an <audio> element
   * reports Infinity for them.
   */
  durationMs: number;
}

export interface Recorder {
  /** Ends the take and resolves with it. */
  stop(): Promise<Take>;
  /** Ends the take and throws it away, releasing the microphone either way. */
  cancel(): void;
}

/**
 * Why the microphone cannot be used, in words fit to put straight on the page, or null
 * when it can.
 *
 * The secure-context case is the one that will actually happen: over plain http on a
 * LAN address the browser does not merely refuse permission, it removes
 * navigator.mediaDevices altogether, so a page that only caught the permission error
 * would report nothing at all.
 */
export function micUnavailableReason(): string | null {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) return null;

  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    return 'Recording needs a secure connection. Open the app over https, or on localhost, to record.';
  }
  return 'This browser will not give the page a microphone.';
}

/** Asks for the microphone and starts recording. Rejects if permission is refused. */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = Date.now();

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();

  // Tracks stay live until stopped by hand. Without this the browser goes on showing
  // the recording indicator after the take is over, which is alarming and fair.
  const release = () => stream.getTracks().forEach((track) => track.stop());

  return {
    stop: () =>
      new Promise<Take>((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            release();
            resolve({
              blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
              durationMs: Date.now() - startedAt,
            });
          },
          { once: true },
        );
        recorder.stop();
      }),

    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/** Uploads a take, replacing whatever was stored before. */
export function saveRecording(take: Take): Promise<{ recording: GoalRecording }> {
  const ms = Math.round(take.durationMs);
  return api.postBlob<{ recording: GoalRecording }>(
    `/goals/recording?duration_ms=${ms}`,
    take.blob,
  );
}

/** "1:42". Clock-shaped, because that is how long a thing feels. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';

  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

```sh
npx vitest run src/__tests__/recording.test.ts --root web
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```sh
npm run format --prefix web && npm run lint --prefix web
git add web/src/recording.ts web/src/__tests__/recording.test.ts web/src/api.ts web/src/types.ts
git commit -m "Capture the microphone and send the take up"
```

---

## Task 5: The player

The speaker button on the Goals title row.

**Files:**
- Create: `web/src/components/GoalsPlayer.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `GoalRecording` (Task 4), `GET /api/goals/recording/audio` (Task 3)
- Produces: `<GoalsPlayer recording={GoalRecording | null} />` — renders nothing at all when `recording` is null

- [ ] **Step 1: Write the component**

Create `web/src/components/GoalsPlayer.tsx`:

```tsx
/**
 * The goals, read back in your own voice.
 *
 * A single button on the title row: a speaker when idle, a stop square while playing.
 * Pressing it while it plays stops and rewinds — there is no pause, because the page
 * this sits on is for reading and a scrubber across the top of it would cost more room
 * than restarting a two-minute recording costs patience.
 */

import { useEffect, useRef, useState } from 'react';
import type { GoalRecording } from '../types';

export function GoalsPlayer({ recording }: { recording: GoalRecording | null }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

  /**
   * A recording replaced or deleted while the page is open must not leave the old
   * bytes playing under the new state. Leaving the tab unmounts the whole component,
   * which stops it for the same reason.
   */
  useEffect(() => {
    setPlaying(false);
    setError('');
    const el = audioRef.current;
    return () => {
      el?.pause();
    };
  }, [recording?.recorded_at]);

  if (!recording) return null;

  // The cache-buster is belt and braces next to the server's no-store: without it a
  // re-record can still be answered from the in-memory cache of the element itself.
  const src = `/api/goals/recording/audio?v=${recording.recorded_at}`;

  function toggle() {
    const el = audioRef.current;
    if (!el) return;

    if (playing) {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
      return;
    }

    setError('');
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setError('Could not play that recording.'));
  }

  return (
    <>
      <button
        className="btn-icon"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? 'Stop the recording' : 'Play the goals'}
      >
        {playing ? <StopIcon /> : <SpeakerIcon />}
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setError('Could not play that recording.');
        }}
      />

      {error && <div className="error">{error}</div>}
    </>
  );
}

/* Hand-rolled inline SVG, like the charts: 24-unit box, currentColor throughout, so
   the button's own colour states carry the icon with them. */

function SpeakerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" />
      <path
        d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
    </svg>
  );
}
```

**Note on the error element:** it renders as a sibling of the button, inside the title row's flex container. That is deliberate and it is checked on screen in Task 7 — if it distorts the row, move it out to the page body then.

- [ ] **Step 2: Add the styles**

In `web/src/styles.css`, add to the buttons section, after `.btn-ghost`:

```css
/* A square tap target for an icon with no label beside it. 44px is the smallest thing
   a thumb finds reliably; the icon inside is smaller than that on purpose, so the
   generous part is the target and not the mark. The negative margin pulls the button
   back to the text edge — its padding is tap target, not gutter. */
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 44px;
  margin-right: -11px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--text-dim);
}

.btn-icon:active {
  background: var(--surface-2);
}

/* Playing is a state, so it takes the accent — the same way the review tick does. */
.btn-icon[aria-pressed='true'] {
  color: var(--accent);
}
```

and next to `.screen-title`:

```css
/* A screen title with something that acts on the whole page pushed to the far edge.
   The title keeps its own font size; this only arranges. */
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
```

- [ ] **Step 3: Typecheck**

```sh
npm run build --prefix web
```

Expected: PASS. (`web`'s build runs `tsc --noEmit` first — there are no unit tests for this component; it is verified on screen in Task 7.)

- [ ] **Step 4: Commit**

```sh
npm run format --prefix web && npm run lint --prefix web
git add web/src/components/GoalsPlayer.tsx web/src/styles.css
git commit -m "Play the goals back from the title row"
```

---

## Task 6: The recorder

**Files:**
- Create: `web/src/components/GoalsRecorder.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `startRecording`, `saveRecording`, `micUnavailableReason`, `formatDuration`, `MAX_RECORDING_MS`, `Take`, `Recorder` (Task 4); `GoalRecording` (Task 4); `api.del` (existing)
- Produces: `<GoalsRecorder recording={GoalRecording | null} onChange={(next: GoalRecording | null) => void} />`

- [ ] **Step 1: Write the component**

Create `web/src/components/GoalsRecorder.tsx`:

```tsx
/**
 * Recording the goals, at the foot of the page you read them from.
 *
 * It lives down here rather than in a sheet or on another screen because the reading
 * and the recording are the same act: the plan stays on the page, scrollable, while
 * the take runs.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  startRecording,
  saveRecording,
  micUnavailableReason,
  formatDuration,
  MAX_RECORDING_MS,
  type Recorder,
  type Take,
} from '../recording';
import type { GoalRecording } from '../types';

type Stage =
  | { name: 'idle' }
  | { name: 'starting' }
  | { name: 'recording'; recorder: Recorder }
  | { name: 'review'; take: Take }
  | { name: 'saving' };

export function GoalsRecorder({
  recording,
  onChange,
}: {
  recording: GoalRecording | null;
  onChange: (next: GoalRecording | null) => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const takeUrl = useObjectUrl(stage.name === 'review' ? stage.take.blob : null);

  /**
   * The running timer, and the cap that ends a take on its own.
   *
   * Stopping at the cap rather than letting it run means a recorder left going by
   * accident cannot grow past what the server will accept — the take you actually made
   * is saved, rather than refused after the fact.
   */
  useEffect(() => {
    if (stage.name !== 'recording') return;

    const startedAt = Date.now();
    setElapsed(0);

    const tick = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) void finish(stage.recorder);
    }, 200);

    return () => clearInterval(tick);
    // finish is stable enough for this: it only ever reads the recorder handed to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  /**
   * An unmount mid-take must not leave the microphone open.
   *
   * This cleanup also fires on the ordinary move from recording to review, with the
   * old stage closed over, so cancel() gets called on a recorder that has already
   * stopped. That is deliberately harmless — cancel checks the state before stopping,
   * and stopping an ended track is a no-op — and it is what makes the unmount case
   * need no separate bookkeeping. Do not "fix" it by dropping stage from the deps.
   */
  useEffect(() => {
    return () => {
      if (stage.name === 'recording') stage.recorder.cancel();
    };
  }, [stage]);

  async function begin() {
    setError('');
    setConfirmingDelete(false);

    const unavailable = micUnavailableReason();
    if (unavailable) {
      setError(unavailable);
      return;
    }

    setStage({ name: 'starting' });
    try {
      const recorder = await startRecording();
      setStage({ name: 'recording', recorder });
    } catch {
      // Overwhelmingly this is the permission prompt being dismissed.
      setStage({ name: 'idle' });
      setError('The microphone was not allowed. Check the site permissions and try again.');
    }
  }

  async function finish(recorder: Recorder) {
    const take = await recorder.stop();
    setStage({ name: 'review', take });
  }

  async function save(take: Take) {
    setStage({ name: 'saving' });
    setError('');
    try {
      const { recording: saved } = await saveRecording(take);
      onChange(saved);
      setStage({ name: 'idle' });
    } catch (err) {
      // Back to review, not to idle: the take is still in hand and still savable.
      setStage({ name: 'review', take });
      setError(err instanceof Error ? err.message : 'Could not save that recording');
    }
  }

  async function remove() {
    setError('');
    try {
      await api.del('/goals/recording');
      onChange(null);
      setConfirmingDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that recording');
    }
  }

  return (
    <div className="recorder">
      {stage.name === 'recording' && (
        <>
          <div className="recorder-status">
            <span className="recorder-dot" aria-hidden="true" />
            Recording <span className="recorder-time">{formatDuration(elapsed)}</span>
          </div>
          <button className="btn btn-block" onClick={() => void finish(stage.recorder)}>
            Stop
          </button>
        </>
      )}

      {stage.name === 'review' && (
        <>
          <div className="recorder-status">
            Listen back — {formatDuration(stage.take.durationMs)}
          </div>
          {takeUrl && <audio className="recorder-preview" src={takeUrl} controls />}
          <div className="recorder-actions">
            <button className="btn" onClick={() => setStage({ name: 'idle' })}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={() => void save(stage.take)}>
              Save
            </button>
          </div>
        </>
      )}

      {stage.name === 'saving' && (
        <button className="btn btn-block" disabled>
          Saving…
        </button>
      )}

      {(stage.name === 'idle' || stage.name === 'starting') && (
        <>
          <button
            className="btn btn-block"
            onClick={() => void begin()}
            disabled={stage.name === 'starting'}
          >
            {recording ? 'Re-record the goals' : 'Record the goals'}
          </button>

          {recording && (
            <div className="recorder-existing">
              <span className="muted tiny">
                Recorded {recordedOn(recording.recorded_at)} ·{' '}
                {formatDuration(recording.duration_ms)}
              </span>

              {confirmingDelete ? (
                <span className="recorder-confirm">
                  <button className="btn-ghost tiny" onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </button>
                  <button className="btn-ghost tiny danger" onClick={() => void remove()}>
                    Delete
                  </button>
                </span>
              ) : (
                <button className="btn-ghost tiny" onClick={() => setConfirmingDelete(true)}>
                  Delete recording
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** "12 Aug". The year is left off: a recording of the plan is not an anniversary. */
function recordedOn(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * An object URL for a blob, revoked when the blob changes or the component goes.
 *
 * Without the revoke every discarded take stays in memory for the life of the page,
 * which for a ten-minute recording is not a rounding error.
 */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (previous.current) URL.revokeObjectURL(previous.current);

    if (!blob) {
      previous.current = null;
      setUrl(null);
      return;
    }

    const next = URL.createObjectURL(blob);
    previous.current = next;
    setUrl(next);

    return () => {
      URL.revokeObjectURL(next);
      previous.current = null;
    };
  }, [blob]);

  return url;
}
```

- [ ] **Step 2: Add the styles**

Append to `web/src/styles.css`, at the end of the file:

```css
/* ---------- recording the goals ---------- */

.recorder {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.recorder-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 14px;
}

/* Red, because it is a recording light and nothing else in the app is. Not the amber
   --warn: this is not a warning, and amber is spoken for. */
.recorder-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--over);
  animation: recorder-pulse 1.4s ease-in-out infinite;
}

@keyframes recorder-pulse {
  50% {
    opacity: 0.25;
  }
}

/* Tabular figures so the seconds do not shuffle the line about as they count. */
.recorder-time {
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.recorder-preview {
  width: 100%;
}

.recorder-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.recorder-existing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.recorder-confirm {
  display: flex;
  align-items: center;
  gap: 2px;
}

.danger {
  color: var(--over);
}

@media (prefers-reduced-motion: reduce) {
  .recorder-dot {
    animation: none;
  }
}
```

Before adding `.tiny` usages, check whether `.tiny` and `.muted` already exist in `styles.css` — `.muted` does, and `Goals.tsx` already uses `note tiny`, so both are present. Do not redefine them.

- [ ] **Step 3: Typecheck**

```sh
npm run build --prefix web
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
npm run format --prefix web && npm run lint --prefix web
git add web/src/components/GoalsRecorder.tsx web/src/styles.css
git commit -m "Record the goals from the page you read them on"
```

---

## Task 7: Wire it into the Goals screen and look at it

**Files:**
- Modify: `web/src/screens/Goals.tsx`

**Interfaces:**
- Consumes: `<GoalsPlayer>` (Task 5), `<GoalsRecorder>` (Task 6), `GET /api/goals/recording` (Task 3)
- Produces: nothing further

- [ ] **Step 1: Wire the screen**

In `web/src/screens/Goals.tsx`, add to the imports:

```tsx
import { GoalsPlayer } from '../components/GoalsPlayer';
import { GoalsRecorder } from '../components/GoalsRecorder';
import type { GoalRecording } from '../types';
```

add state and a fetch inside the component, after the existing `const [error, setError] = useState('')`:

```tsx
  const [recording, setRecording] = useState<GoalRecording | null>(null);
  const [recordingError, setRecordingError] = useState('');

  /**
   * Kept apart from the review write above: that one runs on every day change, this one
   * only on arrival, and a failure in either must not be reported as the other. Failing
   * here means no speaker button, so it says so rather than leaving a silent gap.
   */
  useEffect(() => {
    let cancelled = false;

    api
      .get<{ recording: GoalRecording | null }>('/goals/recording')
      .then(({ recording }) => {
        if (!cancelled) setRecording(recording);
      })
      .catch(() => {
        if (!cancelled) setRecordingError('Could not check for a saved recording.');
      });

    return () => {
      cancelled = true;
    };
  }, []);
```

change the title line to a row:

```tsx
      <div className="title-row">
        <h1 className="screen-title">Goals</h1>
        <GoalsPlayer recording={recording} />
      </div>
```

and add the recorder at the very bottom of the returned `<div className="stack">`, after the "Marked … as reviewed" note:

```tsx
      {recordingError && <div className="error">{recordingError}</div>}

      <GoalsRecorder recording={recording} onChange={setRecording} />
```

- [ ] **Step 2: Typecheck and run the whole check**

```sh
npm run check
```

Expected: PASS — server tests, web tests, both lints, both format checks.

- [ ] **Step 3: Set up a throwaway account and look at the page**

The repo has no way to log in as Van without the password, so screenshots use a disposable user that gets deleted afterwards.

```sh
npm run create-user --prefix server -- shot
npm run seed-demo --prefix server -- shot
./dev.sh
```

- [ ] **Step 4: Drive it with Playwright**

Write this to the scratchpad (not the repo) and run it. Use `localhost`, not the LAN IP — the microphone needs a secure context and `localhost` counts as one.

```js
// shot.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  colorScheme: 'dark',
  permissions: ['microphone'],
});
const page = await context.newPage();

await page.goto('http://localhost:5174');
await page.fill('input[name="username"], input[type="text"]', 'shot');
await page.fill('input[type="password"]', '<the password you just set>');
await page.click('button[type="submit"]');
await page.waitForSelector('.tabbar');

await page.click('button:has-text("Goals")');
await page.waitForSelector('.title-row');

// Nothing recorded yet: no speaker, and the button says Record.
console.log('speaker before:', await page.locator('.btn-icon').count());
console.log('button:', await page.locator('.recorder .btn-block').innerText());
await page.screenshot({ path: 'goals-empty.png', fullPage: true });

// Measure rather than eyeball, per CLAUDE.md.
const clipped = await page.$$eval('.title-row *', (els) =>
  els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
);
console.log('clipped in the title row:', clipped);

await browser.close();
```

```sh
node /private/tmp/claude-501/*/scratchpad/shot.mjs
```

Expected: `speaker before: 0`, `button: Record the goals`, `clipped in the title row: []`.

- [ ] **Step 5: Record a real take by hand, then measure the title row again**

Playwright's fake microphone needs Chrome launched with `--use-fake-device-for-media-stream`, which produces a beep rather than a voice — good enough to prove the round trip. Add to the `launch` call and re-run with a recording step:

```js
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
```

then, after reaching the Goals tab:

```js
await page.click('button:has-text("Record the goals")');
await page.waitForSelector('.recorder-dot');
await page.waitForTimeout(3000);
await page.click('button:has-text("Stop")');
await page.waitForSelector('.recorder-preview');
await page.screenshot({ path: 'goals-review.png', fullPage: true });

await page.click('button:has-text("Save")');
await page.waitForSelector('.btn-icon');
console.log('speaker after:', await page.locator('.btn-icon').count());
console.log('button now:', await page.locator('.recorder .btn-block').innerText());

// The title row must not have grown or clipped now that it has a button in it.
console.log('title row height:', await page.locator('.title-row').evaluate((el) => el.clientHeight));
const clippedAfter = await page.$$eval('.title-row *', (els) =>
  els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
);
console.log('clipped after:', clippedAfter);

await page.click('.btn-icon');
await page.waitForTimeout(500);
console.log('pressed while playing:', await page.locator('.btn-icon').getAttribute('aria-pressed'));
await page.screenshot({ path: 'goals-playing.png', fullPage: true });
```

Expected: `speaker after: 1`, `button now: Re-record the goals`, `clipped after: []`, `pressed while playing: true`.

Look at all three screenshots. Check the light theme too by rerunning with `colorScheme: 'light'`.

- [ ] **Step 6: Delete the throwaway account**

```sh
sqlite3 data/app.db "DELETE FROM users WHERE username='shot'"
```

The row cascade takes the recording row with it. **The audio file it wrote does not go** — that is the known limit named in the spec, so clear it by hand:

```sh
rm -f data/audio/goals-*.webm
```

- [ ] **Step 7: Commit**

```sh
npm run format --prefix web && npm run lint --prefix web
git add web/src/screens/Goals.tsx
git commit -m "Put the recording controls on the goals page"
```

---

## Task 8: Backup and deployment notes

The audio no longer lives in the database, so the nightly backup has to grow a second half. The backup is documented but not yet running, so this is a change to the docs and a new script rather than to a live crontab.

**Files:**
- Create: `scripts/backup.sh`
- Modify: `docs/deployment.md`, `CLAUDE.md`

- [ ] **Step 1: Write the backup script**

Create `scripts/backup.sh`:

```sh
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
```

```sh
chmod +x scripts/backup.sh
```

- [ ] **Step 2: Check it runs locally**

`HEALTH_DATA` exists so the script can be exercised against the local data directory rather than only on the VPS.

```sh
HEALTH_DATA="$PWD/data" ./scripts/backup.sh
ls data/backups
```

Expected: `app-<today>.db`, and `audio-<today>.tar.gz` if anything has been recorded. Then clean up — `data/` is gitignored, but leaving backups in the working tree is clutter:

```sh
rm -rf data/backups
```

- [ ] **Step 3: Update the deployment doc**

In `docs/deployment.md`:

**a.** In the `~/health-data/.env` block in step 3, add a line under `DB_PATH`:

```
MEDIA_DIR=/home/griljor/health-data/audio
```

(It is the default — an `audio/` sibling of `DB_PATH` — but writing it down is what makes the backup script's `$DATA/audio` and the app's idea of where recordings go visibly the same path.)

**b.** In the nginx server block in step 4, inside `location /api/`, add:

```nginx
        # A goals recording is posted as the request body. nginx's default cap is 1m,
        # which a two-minute reading clears and a longer one does not — and the failure
        # arrives as an nginx 413 the app never sees. Kept a little above the server's
        # own 10 MB limit so the app's error message is the one that gets shown.
        client_max_body_size 12m;
```

**c.** Replace the whole of section 8 with:

````markdown
### 8. Nightly backup

The database and the recordings are two files in two places, so the backup covers
both — see `scripts/backup.sh`. A `.backup` of `app.db` alone would look complete
and quietly lose every recording.

```sh
crontab -e
```

```
0 3 * * * /home/griljor/health/scripts/backup.sh >> /home/griljor/health-data/backup.log 2>&1
```

Keeps 14 days of each. Check it after the first night — this is the first thing on
this VPS with a real database, and the data exists nowhere else:

```sh
ls -la ~/health-data/backups
tail ~/health-data/backup.log
```
````

- [ ] **Step 4: Update CLAUDE.md**

**a.** In the Deployment section, replace the third rule with:

```markdown
- **Set up the nightly backup before relying on it.** `scripts/backup.sh` covers two
  things — `app.db` and the `audio/` directory of goals recordings beside it — because
  the recordings deliberately are not in the database. A `.backup` of the database
  alone looks complete and loses every recording. This is the first thing on that VPS
  with real data; it exists nowhere else.
```

**b.** In the Architecture section, under `server/`, add to the `src/domain/` list `recording` (mime allowlist, size and length caps, filenames), and add after the `src/usda.ts` bullet:

```markdown
  - Recordings of the goals are **files, not rows**: the audio lives in `MEDIA_DIR`
    (`data/audio/` locally, beside `app.db` in production) and `goal_recordings` holds
    one metadata row per user. Uploads arrive as a raw `audio/*` body through a regex
    content-type parser — there is no multipart dependency — and the POST route carries
    its own `bodyLimit`, because Fastify's default of 1 MB is under a long recording.
```

**c.** In "Things that are subtle", add:

```markdown
**A recording's duration is measured by the recorder, not read from the file.** Blobs
out of `MediaRecorder` routinely carry no duration in their header and an `<audio>`
element reports `Infinity` for them, so the web recorder counts elapsed milliseconds
itself and posts them as `?duration_ms=`. Do not "simplify" this by reading it back
off the element.

**Recording needs a secure context.** `getUserMedia` is absent — not merely refused —
over plain http, so recording cannot work from the phone at `http://<LAN-IP>:5174`.
Playback is unaffected. The recorder says which of the two it is rather than failing
silently. On the Mac, `localhost:5174` counts as secure and can be used to test capture.
```

- [ ] **Step 5: Run the full check and commit**

```sh
npm run check
```

Expected: PASS.

```sh
git add scripts/backup.sh docs/deployment.md CLAUDE.md
git commit -m "Back up the recordings along with the database"
```

---

## Done when

- [ ] `npm run check` passes
- [ ] The Goals page shows no speaker button until something is recorded
- [ ] Recording, reviewing, saving, and playing back all work at `localhost:5174`
- [ ] Re-recording replaces both the row and the file, leaving one file in `data/audio/`
- [ ] Deleting the recording removes the speaker button
- [ ] `HEALTH_DATA="$PWD/data" ./scripts/backup.sh` produces both a `.db` and a `.tar.gz`
- [ ] The throwaway `shot` account and its audio file are gone
