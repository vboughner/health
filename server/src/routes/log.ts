import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { toGrams, nutritionForGrams, type Unit } from '../domain/nutrition';
import { warningText } from '../domain/processed';
import { localDay } from '../domain/day';
import {
  getFood,
  upsertFood,
  insertFoodLog,
  listFoodLog,
  getFoodLogEntry,
  deleteFoodLog,
  type NewFood,
} from '../store';

const UNITS: Unit[] = ['g', 'oz', 'serving'];

interface LogFoodBody {
  /** An already-saved food… */
  food_id?: number;
  /** …or a new one, from a USDA search result or typed by hand. */
  food?: NewFood;
  quantity: number;
  unit: Unit;
  /** Defaults to now. Present so a forgotten meal can be logged at its real time. */
  eaten_at?: number;
}

export function registerLogRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.post<{ Body: LogFoodBody }>(
    '/log/food',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body ?? ({} as LogFoodBody);

      if (
        typeof body.quantity !== 'number' ||
        !Number.isFinite(body.quantity) ||
        body.quantity <= 0
      ) {
        return reply.code(400).send({ error: 'Quantity must be a positive number' });
      }
      if (!UNITS.includes(body.unit)) {
        return reply.code(400).send({ error: `Unit must be one of ${UNITS.join(', ')}` });
      }

      // Resolve the food: either one we already have, or one to store now.
      let food;
      if (typeof body.food_id === 'number') {
        food = getFood(opts.db, body.food_id);
        if (!food) return reply.code(404).send({ error: 'Food not found' });
      } else if (body.food) {
        if (!body.food.name?.trim() || typeof body.food.kcal_per_100g !== 'number') {
          return reply.code(400).send({ error: 'Food needs a name and calories per 100 g' });
        }
        food = upsertFood(opts.db, user.id, body.food);
      } else {
        return reply.code(400).send({ error: 'Provide either food_id or food' });
      }

      let grams: number;
      try {
        grams = toGrams(body.quantity, body.unit, food.serving_grams, food.weight_unknown);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Invalid amount' });
      }

      const eatenAt = typeof body.eaten_at === 'number' ? body.eaten_at : Date.now();
      const nutrition = nutritionForGrams(food, grams);

      const id = insertFoodLog(opts.db, user.id, {
        food_id: food.id,
        // Snapshot the name too, so an entry still reads correctly if the food row goes away.
        food_name: food.name,
        eaten_at: eatenAt,
        local_day: localDay(eatenAt, user.timezone),
        quantity: body.quantity,
        unit: body.unit,
        grams,
        // Snapshotted alongside the calories: how this entry reads must not change
        // if the food behind it is later edited or re-cached.
        weight_unknown: food.weight_unknown,
        nutrition,
      });

      return reply.code(201).send({
        entry: getFoodLogEntry(opts.db, user.id, id),
        food,
        // A nudge, not a block — the entry is already saved either way.
        warning: warningText(food.processed_flags) || null,
      });
    },
  );

  app.get<{ Querystring: { date?: string } }>(
    '/log/food',
    { preHandler: app.requireUser },
    async (request) => {
      const user = request.user!;
      const day = request.query.date ?? localDay(Date.now(), user.timezone);
      return { entries: listFoodLog(opts.db, user.id, day), date: day };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/log/food/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid id' });

      // Scoped to the user, so this 404s rather than deleting someone else's entry.
      if (!deleteFoodLog(opts.db, request.user!.id, id)) {
        return reply.code(404).send({ error: 'Entry not found' });
      }

      return reply.code(204).send();
    },
  );
}
