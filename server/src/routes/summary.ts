import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay, addDays, eatingWindow, sleepHours } from '../domain/day';
import { sumNutrition, macroSplit } from '../domain/nutrition';
import { goalsForDay } from '../domain/goals';
import { listFoodLog, listExercise, getDailyEntry, listGoalPeriods } from '../store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One call powering the whole Today screen: what was eaten, what was burned, the
 * eating window derived from the log, sleep, and weight.
 *
 * Assembling it server-side keeps the phone to a single request and means the
 * derived numbers are computed once, in the place that owns the rules.
 */
export function registerSummaryRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.get<{ Params: { date: string } }>(
    '/summary/:date',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const today = localDay(Date.now(), user.timezone);
      const date = request.params.date === 'today' ? today : request.params.date;

      if (!DATE_RE.test(date)) return reply.code(400).send({ error: 'Expected a YYYY-MM-DD date' });

      const foods = listFoodLog(opts.db, user.id, date);
      const exercise = listExercise(opts.db, user.id, date);
      const day = getDailyEntry(opts.db, user.id, date);
      // A night spans two records: you went to bed yesterday evening and got up
      // this morning. Each field belongs to the calendar day you did it on, so the
      // pair has to be read across the boundary.
      const previous = getDailyEntry(opts.db, user.id, addDays(date, -1));
      const goals = goalsForDay(listGoalPeriods(opts.db, user.id), date);

      const totals = sumNutrition(foods);
      const burned = Math.round(exercise.reduce((sum, e) => sum + e.kcal, 0));
      const window = eatingWindow(
        foods.map((f) => f.eaten_at),
        user.timezone,
        goals.window_start,
        goals.window_end,
      );

      return {
        date,
        food: {
          entries: foods,
          totals,
          macros: macroSplit(totals),
          budget: goals.kcal_budget,
          remaining: Math.round(goals.kcal_budget - totals.kcal),
        },
        exercise: {
          entries: exercise,
          total: burned,
          target: goals.burn_target,
        },
        window: {
          ...window,
          target_start: goals.window_start,
          target_end: goals.window_end,
        },
        day: {
          ...day,
          sleep_hours: sleepHours(previous.sleep_start, day.sleep_end),
        },
      };
    },
  );
}
