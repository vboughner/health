import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
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

    return (
      reply
        .type(rec.mime)
        // Never cached. The file is small, and the alternative is hearing yesterday's
        // take after re-recording.
        .header('Cache-Control', 'no-store')
        .header('Content-Length', String(size))
        .send(fs.createReadStream(file))
    );
  });

  app.post<{ Querystring: { duration_ms?: string } }>(
    '/goals/recording',
    // Fastify's default body limit is 1 MB, which a two-minute recording clears and a
    // long one does not. Raising it to MAX_AUDIO_BYTES here is what lets a valid long
    // recording reach the handler at all, rather than 413ing during parsing.
    { preHandler: app.requireUser, bodyLimit: MAX_AUDIO_BYTES },
    async (request, reply) => {
      const userId = request.user!.id;

      // The type is judged before the body is looked at. A request that is not audio at
      // all — application/json, say — never reaches the parser above, so its body is a
      // parsed object rather than a Buffer; answering that with "expected audio in the
      // body" would blame the bytes for a header's mistake. 415 names the real problem.
      const mime = normalizeMime(request.headers['content-type'] ?? '');
      const ext = extensionFor(mime);
      if (!ext) {
        return reply.code(415).send({ error: `Cannot store ${mime || 'that kind of'} audio` });
      }

      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.code(400).send({ error: 'Expected audio in the request body' });
      }
      // Defence in depth: with bodyLimit above set to MAX_AUDIO_BYTES, Fastify rejects
      // an oversized body during parsing and this branch cannot run. Kept in case the
      // two limits ever diverge.
      if (body.length > MAX_AUDIO_BYTES) {
        return reply.code(413).send({ error: 'That recording is too long to store' });
      }

      // From the recorder's own clock, not from the file: blobs out of MediaRecorder
      // routinely carry no duration in their header.
      const durationMs = Number(request.query.duration_ms);
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return reply.code(400).send({ error: 'Expected a positive duration_ms' });
      }
      // The recorder already stops a take at MAX_RECORDING_MS, but duration_ms is a
      // client-supplied query parameter — a claim, not a measurement — and nothing
      // stops a bad or malformed one arriving here regardless of what the recorder did.
      if (durationMs > MAX_RECORDING_MS) {
        return reply.code(400).send({ error: 'Cannot store a recording longer than ten minutes' });
      }

      const recordedAt = Date.now();
      const filename = recordingFilename(userId, recordedAt, ext);
      const finalPath = path.join(opts.mediaDir, filename);

      // Written under a temp name and renamed into place, so a write that dies part
      // way through is never observed: a reader sees the complete take appear
      // atomically, or not at all.
      fs.mkdirSync(opts.mediaDir, { recursive: true });
      fs.writeFileSync(`${finalPath}.part`, body);
      fs.renameSync(`${finalPath}.part`, finalPath);

      const rec: GoalRecording = {
        filename,
        mime,
        bytes: body.length,
        duration_ms: Math.round(durationMs),
        recorded_at: recordedAt,
      };
      const previous = putGoalRecording(opts.db, userId, rec);

      // Only now, with the row pointing at the new file, is the old one unreferenced.
      // Two takes inside the same millisecond would share a name; the guard keeps that
      // from deleting the file just written.
      if (previous && previous.filename !== filename) {
        removeQuietly(app, opts.mediaDir, previous.filename);
      }

      return reply.code(201).send({ recording: publicView(rec) });
    },
  );

  app.delete('/goals/recording', { preHandler: app.requireUser }, async (request, reply) => {
    const previous = deleteGoalRecording(opts.db, request.user!.id);
    if (!previous) return reply.code(404).send({ error: 'No recording' });

    removeQuietly(app, opts.mediaDir, previous.filename);
    return reply.code(204).send();
  });
}
