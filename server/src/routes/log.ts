import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import {
  toGrams,
  nutritionForGrams,
  quickNutrition,
  scaleNutrition,
  factorForKcal,
  type Unit,
} from '../domain/nutrition';
import { warningText } from '../domain/processed';
import { localDay } from '../domain/day';
import {
  getFood,
  upsertFood,
  insertFoodLog,
  listFoodLog,
  getFoodLogEntry,
  updateFoodLog,
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

interface QuickLogBody {
  /** Whatever you call it. Never stored as a food, so it needs no more than this. */
  name: string;
  /** What the whole serving cost. There is no quantity to multiply it by. */
  kcal: number;
  eaten_at?: number;
}

/**
 * A correction to an entry already logged. Every field optional — only what is
 * sent changes — but `quantity` and `kcal` are mutually exclusive, and which of
 * the four apply depends on whether the entry has a food behind it.
 */
interface EditEntryBody {
  /** Quick entries only: they are the only kind whose name is their own. */
  name?: string;
  /** Food entries only, in the unit the entry was logged in. */
  quantity?: number;
  kcal?: number;
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

  /**
   * A serving you already know: a name, its calories, and when you ate it.
   *
   * Deliberately not a branch of POST /log/food. That route resolves a food,
   * converts to grams and scales per-100g figures; this one does none of it and
   * saves no food, so the two share only the timestamp. Nothing here reaches the
   * foods table, which is the point — this is not a food you will pick again.
   */
  app.post<{ Body: QuickLogBody }>(
    '/log/quick',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body ?? ({} as QuickLogBody);
      const name = typeof body.name === 'string' ? body.name.trim() : '';

      if (!name) return reply.code(400).send({ error: 'Give it a name' });

      let nutrition;
      try {
        nutrition = quickNutrition(body.kcal);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Invalid calories' });
      }

      const eatenAt = typeof body.eaten_at === 'number' ? body.eaten_at : Date.now();

      const id = insertFoodLog(opts.db, user.id, {
        food_id: null,
        food_name: name,
        eaten_at: eatenAt,
        local_day: localDay(eatenAt, user.timezone),
        // One entry is one serving of one thing. The grams are not zero because it
        // weighs nothing; there is no weight, which is what the flags say.
        quantity: 1,
        unit: 'serving',
        grams: 0,
        weight_unknown: true,
        macros_unknown: true,
        nutrition,
      });

      return reply.code(201).send({ entry: getFoodLogEntry(opts.db, user.id, id) });
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

  /**
   * Correct an entry already in the log.
   *
   * Everything here scales what the entry *recorded*, never the food behind it.
   * `food_log` snapshots its calories and macros precisely so that re-caching a
   * food cannot rewrite a past day; pricing an edit at the food's current figures
   * would reopen that hole from the other side, so that changing only the time on
   * an old entry would quietly change what it cost.
   *
   * Two consequences. The unit is not editable — the serving size lives on the
   * food and the entry only knows the grams it worked out to. And the amount and
   * the calories are two spellings of one number: typing a calorie figure is
   * another way of saying how much you ate, so it back-solves the amount and
   * carries the macros with it.
   *
   * One route rather than two mirroring the two POSTs above. Those are separate
   * because their inputs are wholly different on the way in; here the row already
   * exists and its own `food_id` says which shape applies, so a client holding an
   * id should not have to pick a URL.
   */
  app.patch<{ Params: { id: string }; Body: EditEntryBody }>(
    '/log/food/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid id' });

      const entry = getFoodLogEntry(opts.db, user.id, id);
      if (!entry) return reply.code(404).send({ error: 'Entry not found' });

      const body = request.body ?? ({} as EditEntryBody);
      const has = (key: keyof EditEntryBody) => body[key] !== undefined && body[key] !== null;
      const isQuick = entry.food_id === null;

      if (!has('name') && !has('quantity') && !has('kcal') && !has('eaten_at')) {
        return reply.code(400).send({ error: 'Nothing to change' });
      }
      if (has('quantity') && has('kcal')) {
        return reply
          .code(400)
          .send({ error: 'Change the amount or the calories — each one sets the other' });
      }
      if (isQuick && has('quantity')) {
        return reply
          .code(400)
          .send({ error: 'This entry has no amount — change what it cost instead' });
      }
      if (!isQuick && has('name')) {
        return reply.code(400).send({ error: 'This entry is named by the food behind it' });
      }

      let eatenAt = entry.eaten_at;
      if (has('eaten_at')) {
        if (typeof body.eaten_at !== 'number' || !Number.isFinite(body.eaten_at)) {
          return reply.code(400).send({ error: 'Invalid time' });
        }
        eatenAt = body.eaten_at;
      }

      let foodName = entry.food_name;
      if (has('name')) {
        const trimmed = typeof body.name === 'string' ? body.name.trim() : '';
        if (!trimmed) return reply.code(400).send({ error: 'Give it a name' });
        foodName = trimmed;
      }

      let quantity = entry.quantity;
      let grams = entry.grams;
      let nutrition = {
        kcal: entry.kcal,
        protein_g: entry.protein_g,
        fat_g: entry.fat_g,
        carb_g: entry.carb_g,
      };

      if (isQuick && has('kcal')) {
        // No amount to scale and no macros to carry: the calories are the entry.
        try {
          nutrition = quickNutrition(body.kcal as number);
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : 'Invalid calories' });
        }
      } else if (!isQuick && (has('quantity') || has('kcal'))) {
        if (entry.quantity <= 0) {
          return reply.code(400).send({ error: 'This entry has no amount to scale' });
        }

        let factor: number;
        if (has('quantity')) {
          const wanted = body.quantity;
          if (typeof wanted !== 'number' || !Number.isFinite(wanted) || wanted <= 0) {
            return reply.code(400).send({ error: 'Amount must be a positive number' });
          }
          quantity = wanted;
          factor = wanted / entry.quantity;
        } else {
          try {
            factor = factorForKcal(entry.kcal, body.kcal as number);
          } catch (err) {
            return reply
              .code(400)
              .send({ error: err instanceof Error ? err.message : 'Invalid calories' });
          }
          // Kept finer than a tenth: a quarter of a serving is a real amount.
          quantity = Math.round(entry.quantity * factor * 1000) / 1000;
        }

        grams = Math.round(entry.grams * factor * 10) / 10;
        nutrition = scaleNutrition(nutrition, factor);
      }

      updateFoodLog(opts.db, user.id, id, {
        food_name: foodName,
        eaten_at: eatenAt,
        // Recomputed rather than carried over: a denormalized day that disagrees
        // with its own timestamp is discovered months later, in a rollup.
        local_day: localDay(eatenAt, user.timezone),
        quantity,
        grams,
        nutrition,
      });

      return reply.send({ entry: getFoodLogEntry(opts.db, user.id, id) });
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
