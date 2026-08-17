import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE,
  authenticate,
  createSession,
  deleteSession,
  sessionCookieOptions,
} from '../auth';
import type { AppOptions } from '../app';
import { goalsForDay, type Goals } from '../domain/goals';
import { listGoalPeriods } from '../store';
import { localDay } from '../domain/day';

interface LoginBody {
  username?: string;
  password?: string;
}

/**
 * The goals in force today — what the Settings screen edits and the app measures by.
 *
 * Spelled out field by field rather than spread with effective_from dropped: the wire
 * shape is a Goals, and an unused destructured binding is the sort of thing eslint is
 * right to object to.
 */
function currentGoals(opts: AppOptions, user: { id: number; timezone: string }): Goals {
  const today = localDay(Date.now(), user.timezone);
  const period = goalsForDay(listGoalPeriods(opts.db, user.id), today);

  return {
    kcal_budget: period.kcal_budget,
    burn_target: period.burn_target,
    window_start: period.window_start,
    window_end: period.window_end,
  };
}

export function registerAuthRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return reply.code(400).send({ error: 'Username and password are required' });
    }

    const user = await authenticate(opts.db, username, password);
    if (!user) {
      return reply.code(401).send({ error: 'Wrong username or password' });
    }

    const token = createSession(opts.db, user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(opts.isProduction));
    return { user, goals: currentGoals(opts, user) };
  });

  app.post('/auth/logout', async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        deleteSession(opts.db, unsigned.value);
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.requireUser }, async (request) => {
    return { user: request.user, goals: currentGoals(opts, request.user!) };
  });
}
