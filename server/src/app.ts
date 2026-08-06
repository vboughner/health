import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import type { Db } from './db';
import { SESSION_COOKIE, getSessionUser, User } from './auth';
import type { UsdaClient } from './usda';
import { registerAuthRoutes } from './routes/auth';
import { registerFoodRoutes } from './routes/foods';
import { registerLogRoutes } from './routes/log';
import { registerDayRoutes } from './routes/day';
import { registerSummaryRoutes } from './routes/summary';
import { registerTrendRoutes } from './routes/trends';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: User;
  }
}

export interface AppOptions {
  db: Db;
  usda: UsdaClient;
  sessionSecret: string;
  isProduction: boolean;
  logger?: boolean;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.decorate('db', opts.db);
  app.decorateRequest('user', undefined);

  app.register(cookie, { secret: opts.sessionSecret });

  // Resolve the session on every request. Routes that need a user use the
  // requireUser preHandler; everything else can still read request.user.
  app.addHook('preHandler', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    request.user = getSessionUser(opts.db, unsigned.value);
  });

  app.decorate('requireUser', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await reply.code(401).send({ error: 'Not logged in' });
    }
  });

  app.register(
    async (api) => {
      registerAuthRoutes(api, opts);
      registerFoodRoutes(api, opts);
      registerLogRoutes(api, opts);
      registerDayRoutes(api, opts);
      registerSummaryRoutes(api, opts);
      registerTrendRoutes(api, opts);
    },
    { prefix: '/api' },
  );

  return app;
}
