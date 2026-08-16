import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay } from '../domain/day';
import { goalsForDay, validateGoals, type Goals } from '../domain/goals';
import { listGoalPeriods, putGoalPeriod } from '../store';

/**
 * How far back an edit reaches.
 *
 * `from_today` starts a new period today and leaves history judged by what it was
 * judged by at the time. `correction` rewrites the period covering today in place —
 * the covering one, not all of them, so fixing an October typo cannot quietly undo a
 * September schedule change.
 *
 * Once you have already edited today the two are the same row, and both do the same
 * thing. That is a property of the data rather than a case to handle.
 */
const SCOPES = ['from_today', 'correction'] as const;
type Scope = (typeof SCOPES)[number];

type GoalsBody = Goals & { scope?: string };

function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

export function registerSettingsRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.put<{ Body: GoalsBody }>(
    '/settings/goals',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const { scope, ...goals } = request.body ?? ({} as GoalsBody);

      if (!isScope(scope)) {
        return reply.code(400).send({ error: `scope must be one of ${SCOPES.join(', ')}` });
      }

      const problem = validateGoals(goals);
      if (problem) return reply.code(400).send({ error: problem });

      const today = localDay(Date.now(), user.timezone);
      const effective_from =
        scope === 'from_today'
          ? today
          : goalsForDay(listGoalPeriods(opts.db, user.id), today).effective_from;

      // Field by field rather than spread. `goals` is whatever survived the rest
      // destructuring of the request body, and better-sqlite3 throws on a named
      // parameter its statement does not use — a stray key in the JSON would be a
      // 500 rather than the 400 it deserves.
      const saved = {
        kcal_budget: goals.kcal_budget,
        burn_target: goals.burn_target,
        window_start: goals.window_start,
        window_end: goals.window_end,
      };

      putGoalPeriod(opts.db, user.id, { effective_from, ...saved });

      return { goals: saved };
    },
  );
}
