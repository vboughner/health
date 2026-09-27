import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay } from '../domain/day';
import { FEATURE_KEYS, type Features } from '../domain/features';
import { goalsForDay, validateGoals, type Goals } from '../domain/goals';
import { listGoalPeriods, putGoalPeriod, setFeatures, getPlan, setPlan } from '../store';

/** Longer than anyone reads at arms length on a phone, and short of a paste accident. */
const PLAN_MAX_CHARS = 50_000;

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

type GoalsBody = Partial<Goals> & { scope?: string };

function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

export function registerSettingsRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.put<{ Body: GoalsBody }>(
    '/settings/goals',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const { scope, ...body } = request.body ?? ({} as GoalsBody);

      if (!isScope(scope)) {
        return reply.code(400).send({ error: `scope must be one of ${SCOPES.join(', ')}` });
      }

      const today = localDay(Date.now(), user.timezone);
      const current = goalsForDay(listGoalPeriods(opts.db, user.id), today);

      // A target the body does not mention keeps its current value; one sent as null is
      // cleared. A phone still on the cached four-field form would otherwise erase both
      // targets the first time it saved a budget.
      const keep = <K extends keyof Goals>(key: K): Goals[K] =>
        key in body ? (body as Goals)[key] : current[key];

      const goals = {
        ...body,
        protein_min_g: keep('protein_min_g'),
        protein_max_g: keep('protein_max_g'),
        weights_per_week: keep('weights_per_week'),
      };

      const problem = validateGoals(goals);
      if (problem) return reply.code(400).send({ error: problem });

      // validateGoals has just confirmed every field below is present and of the right
      // type — `goals` only fails to satisfy Goals in the compiler's eyes because it is
      // built from a Partial.
      const validated = goals as Goals;

      const effective_from = scope === 'from_today' ? today : current.effective_from;

      // Field by field rather than spread. `goals` is whatever survived the rest
      // destructuring of the request body, and better-sqlite3 throws on a named
      // parameter its statement does not use — a stray key in the JSON would be a
      // 500 rather than the 400 it deserves.
      const saved: Goals = {
        kcal_budget: validated.kcal_budget,
        burn_target: validated.burn_target,
        window_start: validated.window_start,
        window_end: validated.window_end,
        protein_min_g: validated.protein_min_g,
        protein_max_g: validated.protein_max_g,
        weights_per_week: validated.weights_per_week,
      };

      putGoalPeriod(opts.db, user.id, { effective_from, ...saved });

      return { goals: saved };
    },
  );

  app.put<{ Body: Record<string, unknown> }>(
    '/settings/features',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const body = request.body ?? {};

      // Built key by key from FEATURE_KEYS rather than taken wholesale, so a body
      // missing one is a 400 and an unrecognised one simply never arrives.
      const features = {} as Features;
      for (const key of FEATURE_KEYS) {
        if (typeof body[key] !== 'boolean') {
          return reply.code(400).send({ error: `${key} must be true or false` });
        }
        features[key] = body[key] as boolean;
      }

      setFeatures(opts.db, request.user!.id, features);
      return { features };
    },
  );

  app.get('/settings/plan', { preHandler: app.requireUser }, async (request) => ({
    plan: getPlan(opts.db, request.user!.id),
  }));

  app.put<{ Body: { plan?: unknown } }>(
    '/settings/plan',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const plan = (request.body ?? {}).plan;

      if (typeof plan !== 'string') return reply.code(400).send({ error: 'plan must be text' });
      if (plan.length > PLAN_MAX_CHARS) {
        return reply.code(400).send({ error: `plan must be under ${PLAN_MAX_CHARS} characters` });
      }

      setPlan(opts.db, request.user!.id, plan);
      return { plan };
    },
  );
}
