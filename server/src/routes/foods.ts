import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { searchSavedFoods, recentFoods, frequentFoods, upsertFood, type NewFood } from '../store';

export function registerFoodRoutes(app: FastifyInstance, opts: AppOptions): void {
  /**
   * Search saved foods first, then USDA.
   *
   * A USDA outage or a missing key degrades to saved-foods-only rather than failing
   * the search — logging a repeat meal must keep working when the network doesn't.
   */
  app.get<{ Querystring: { q?: string } }>(
    '/foods/search',
    { preHandler: app.requireUser },
    async (request) => {
      const query = (request.query.q ?? '').trim();
      const userId = request.user!.id;

      if (query.length < 2) {
        return { saved: [], usda: [], usdaConfigured: opts.usda.configured, usdaError: null };
      }

      const saved = searchSavedFoods(opts.db, userId, query);

      let usda: unknown[] = [];
      let usdaError: string | null = null;
      try {
        const results = await opts.usda.search(query);
        // Anything already saved is shown from the saved list, not twice.
        const savedSourceIds = new Set(saved.map((f) => f.source_id).filter(Boolean));
        usda = results.filter((f) => !savedSourceIds.has(f.source_id));
      } catch (err) {
        usdaError = err instanceof Error ? err.message : 'USDA lookup failed';
        request.log.warn({ err }, 'USDA search failed');
      }

      return { saved, usda, usdaConfigured: opts.usda.configured, usdaError };
    },
  );

  app.get('/foods/recent', { preHandler: app.requireUser }, async (request) => ({
    foods: recentFoods(opts.db, request.user!.id),
  }));

  app.get('/foods/frequent', { preHandler: app.requireUser }, async (request) => ({
    foods: frequentFoods(opts.db, request.user!.id),
  }));

  /** Create a food by hand. Works with no USDA key at all. */
  app.post<{ Body: NewFood }>('/foods', { preHandler: app.requireUser }, async (request, reply) => {
    const body = request.body;

    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: 'Name is required' });
    }
    if (typeof body.kcal_per_100g !== 'number' || !Number.isFinite(body.kcal_per_100g)) {
      return reply.code(400).send({ error: 'Calories per 100 g is required' });
    }

    const food = upsertFood(opts.db, request.user!.id, {
      ...body,
      source: 'manual',
      source_id: null,
      name: body.name.trim(),
    });

    return reply.code(201).send({ food });
  });
}
