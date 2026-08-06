import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay } from '../domain/day';
import { estimateKcal, isActivity, ACTIVITIES } from '../domain/exercise';
import {
  getDailyEntry,
  upsertDailyEntry,
  latestWeight,
  insertExercise,
  listExercise,
  deleteExercise,
  type DailyEntryPatch,
} from '../store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ExerciseBody {
  activity: string;
  minutes: number;
  /** From a watch. When present it wins over the MET estimate and is marked measured. */
  kcal?: number;
  date?: string;
  note?: string | null;
}

export function registerDayRoutes(app: FastifyInstance, opts: AppOptions): void {
  /** The activity list and MET values, so the UI doesn't hardcode its own copy. */
  app.get('/activities', { preHandler: app.requireUser }, async () => ({
    activities: Object.entries(ACTIVITIES).map(([id, a]) => ({ id, ...a })),
  }));

  app.get<{ Params: { date: string } }>(
    '/day/:date',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const date = request.params.date;
      if (!DATE_RE.test(date)) return reply.code(400).send({ error: 'Expected a YYYY-MM-DD date' });

      return { day: getDailyEntry(opts.db, request.user!.id, date) };
    },
  );

  app.put<{ Params: { date: string }; Body: DailyEntryPatch }>(
    '/day/:date',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const date = request.params.date;
      if (!DATE_RE.test(date)) return reply.code(400).send({ error: 'Expected a YYYY-MM-DD date' });

      const patch = request.body ?? {};

      if (patch.weight_lb != null && (!(patch.weight_lb > 0) || patch.weight_lb > 1000)) {
        return reply.code(400).send({ error: 'Weight must be between 0 and 1000 lb' });
      }
      if (
        patch.sleep_start != null &&
        patch.sleep_end != null &&
        patch.sleep_end <= patch.sleep_start
      ) {
        return reply.code(400).send({ error: 'Wake time must be after sleep time' });
      }

      return { day: upsertDailyEntry(opts.db, request.user!.id, date, patch) };
    },
  );

  app.post<{ Body: ExerciseBody }>(
    '/log/exercise',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body ?? ({} as ExerciseBody);

      if (!isActivity(body.activity)) {
        return reply
          .code(400)
          .send({ error: `Activity must be one of ${Object.keys(ACTIVITIES).join(', ')}` });
      }
      if (typeof body.minutes !== 'number' || !(body.minutes > 0)) {
        return reply.code(400).send({ error: 'Minutes must be a positive number' });
      }
      if (body.date !== undefined && !DATE_RE.test(body.date)) {
        return reply.code(400).send({ error: 'Expected a YYYY-MM-DD date' });
      }

      const now = Date.now();
      const day = body.date ?? localDay(now, user.timezone);

      // A watch number is an observation; the MET table is a guess. Keep them labelled
      // so the trend can show how much of the burn total is actually measured.
      let kcal: number;
      let source: 'estimated' | 'measured';

      if (typeof body.kcal === 'number' && body.kcal >= 0) {
        kcal = Math.round(body.kcal);
        source = 'measured';
      } else {
        const weight = latestWeight(opts.db, user.id, day);
        if (weight === null) {
          return reply.code(400).send({
            error: 'Record a weight first, or enter the calories from your watch',
          });
        }
        kcal = estimateKcal(body.activity, body.minutes, weight);
        source = 'estimated';
      }

      const id = insertExercise(opts.db, user.id, {
        local_day: day,
        logged_at: now,
        activity: body.activity,
        minutes: body.minutes,
        kcal,
        source,
        note: body.note ?? null,
      });

      const entry = listExercise(opts.db, user.id, day).find((e) => e.id === id);
      return reply.code(201).send({ entry });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/log/exercise/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid id' });

      if (!deleteExercise(opts.db, request.user!.id, id)) {
        return reply.code(404).send({ error: 'Entry not found' });
      }

      return reply.code(204).send();
    },
  );
}
