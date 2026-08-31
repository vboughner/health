import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay } from '../domain/day';
import {
  estimateKcal,
  isActivity,
  rescaleBurn,
  ACTIVITIES,
  type ActivityId,
} from '../domain/exercise';
import {
  getDailyEntry,
  upsertDailyEntry,
  latestWeight,
  insertExercise,
  listExercise,
  getExerciseEntry,
  updateExercise,
  deleteExercise,
  type DailyEntryPatch,
} from '../store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ExerciseBody {
  activity: string;
  minutes: number;
  date?: string;
}

/** A correction to a workout already logged. Both optional; at least one required. */
interface EditExerciseBody {
  activity?: string;
  minutes?: number;
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

      // Calories come from the MET table scaled by current body weight. There is no
      // second source any more, so a weight on file is required rather than preferred.
      const weight = latestWeight(opts.db, user.id, day);
      if (weight === null) {
        return reply.code(400).send({ error: 'Record a weight first' });
      }

      const kcal = estimateKcal(body.activity, body.minutes, weight);

      const id = insertExercise(opts.db, user.id, {
        local_day: day,
        logged_at: now,
        activity: body.activity,
        minutes: body.minutes,
        kcal,
      });

      const entry = listExercise(opts.db, user.id, day).find((e) => e.id === id);
      return reply.code(201).send({ entry });
    },
  );

  /**
   * Correct a workout already logged.
   *
   * Deliberately does not look up a body weight. The POST above needs one because it
   * has no prior figure to work from; this route has one, and `rescaleBurn` derives
   * the new calories from it — which is what stops an edit re-pricing a workout from
   * months ago at what you weigh today. Reaching for `latestWeight` here is precisely
   * the bug.
   */
  app.patch<{ Params: { id: string }; Body: EditExerciseBody }>(
    '/log/exercise/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid id' });

      const entry = getExerciseEntry(opts.db, user.id, id);
      if (!entry) return reply.code(404).send({ error: 'Entry not found' });

      const body = request.body ?? ({} as EditExerciseBody);
      const has = (key: keyof EditExerciseBody) => body[key] !== undefined && body[key] !== null;

      if (!has('activity') && !has('minutes')) {
        return reply.code(400).send({ error: 'Nothing to change' });
      }

      let activity = entry.activity;
      if (has('activity')) {
        if (!isActivity(body.activity as string)) {
          return reply
            .code(400)
            .send({ error: `Activity must be one of ${Object.keys(ACTIVITIES).join(', ')}` });
        }
        activity = body.activity as string;
      }

      let minutes = entry.minutes;
      if (has('minutes')) {
        if (typeof body.minutes !== 'number' || !(body.minutes > 0)) {
          return reply.code(400).send({ error: 'Minutes must be a positive number' });
        }
        minutes = body.minutes;
      }

      let kcal: number;
      try {
        kcal = rescaleBurn(entry, { activity: activity as ActivityId, minutes });
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Could not rescale that' });
      }

      updateExercise(opts.db, user.id, id, { activity, minutes, kcal });

      return reply.send({ entry: getExerciseEntry(opts.db, user.id, id) });
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
