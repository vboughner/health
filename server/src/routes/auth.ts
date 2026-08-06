import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE,
  authenticate,
  createSession,
  deleteSession,
  sessionCookieOptions,
} from '../auth';
import type { AppOptions } from '../app';

interface LoginBody {
  username?: string;
  password?: string;
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
    return { user };
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
    return { user: request.user };
  });
}
