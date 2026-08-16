import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { testDb, testApp, testMediaDir, loginAs, type Res } from './helpers';
import { nullUsdaClient } from '../usda';
import { MAX_AUDIO_BYTES, MAX_RECORDING_MS } from '../domain/recording';

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

  it('refuses a duration claim over the length cap', async () => {
    const { app, mediaDir, van } = await setup();

    const res = await upload(app, van.cookie, AUDIO, 'audio/webm', MAX_RECORDING_MS + 1);

    expect(res.statusCode).toBe(400);
    // Nothing was written: the claim was rejected before any file was touched.
    expect(fs.readdirSync(mediaDir)).toHaveLength(0);
  });

  it('accepts a take that ran to exactly the cap', async () => {
    const { app, van } = await setup();

    // The recorder stops a take at exactly MAX_RECORDING_MS, so this is the longest
    // honest duration there is. Rejecting it would throw away the one recording the
    // cap exists to save.
    const res = await upload(app, van.cookie, AUDIO, 'audio/webm', MAX_RECORDING_MS);

    expect(res.statusCode).toBe(201);
    expect(res.json().recording.duration_ms).toBe(MAX_RECORDING_MS);
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
    expect(metadata.statusCode).toBe(200);
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
