import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay, dayRange, eatingWindow, sleepHours } from '../domain/day';
import { weeklyTrend, movingAverage, currentStreak, complianceRate } from '../domain/trend';
import { foodTotalsByDay, burnByDay, dailyEntriesInRange } from '../store';

const MAX_DAYS = 365;

/**
 * One row per day over the requested range, plus the headline numbers.
 *
 * Days with nothing recorded are still present, with nulls — a gap in the chart is
 * information (that is a day that went unlogged), and filling it in silently would
 * hide it.
 */
export function registerTrendRoutes(app: FastifyInstance, opts: AppOptions): void {
  app.get<{ Querystring: { days?: string } }>(
    '/trends',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = request.user!;
      const days = Number(request.query.days ?? 30);

      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
        return reply.code(400).send({ error: `days must be between 1 and ${MAX_DAYS}` });
      }

      const today = localDay(Date.now(), user.timezone);
      const range = dayRange(today, days);
      const from = range[0];

      const foodByDay = new Map(
        foodTotalsByDay(opts.db, user.id, from, today).map((r) => [r.local_day, r]),
      );
      const burn = new Map(burnByDay(opts.db, user.id, from, today).map((r) => [r.local_day, r]));
      const entries = new Map(
        dailyEntriesInRange(opts.db, user.id, from, today).map((r) => [r.local_day, r]),
      );

      const rows = range.map((day) => {
        const food = foodByDay.get(day);
        const entry = entries.get(day);

        const window = food
          ? eatingWindow(
              [food.first_eaten_at!, food.last_eaten_at!],
              user.timezone,
              user.window_start,
              user.window_end,
            )
          : null;

        return {
          day,
          kcal: food ? Math.round(food.kcal) : null,
          protein_g: food ? Math.round(food.protein_g) : null,
          fat_g: food ? Math.round(food.fat_g) : null,
          carb_g: food ? Math.round(food.carb_g) : null,
          burned: burn.get(day)?.kcal ?? null,
          exercise_minutes: burn.get(day)?.minutes ?? null,
          weight_lb: entry?.weight_lb ?? null,
          sleep_hours: sleepHours(entry?.sleep_start ?? null, entry?.sleep_end ?? null),
          window_first: window?.first ?? null,
          window_last: window?.last ?? null,
          window_compliant: window?.compliant ?? null,
          goals_reviewed: entry?.goals_reviewed ?? false,
        };
      });

      const weights = rows
        .filter((r) => r.weight_lb !== null)
        .map((r) => ({ day: r.day, value: r.weight_lb! }));

      const loggedDays = rows.filter((r) => r.kcal !== null);
      const windowDays = rows.filter((r) => r.window_compliant !== null);
      const reviewedDays = rows.filter((r) => r.goals_reviewed);

      return {
        from,
        to: today,
        days: rows,
        budget: user.daily_kcal_budget,
        burn_target: user.daily_burn_target,
        summary: {
          weight_trend_per_week: weeklyTrend(weights),
          weight_smoothed: movingAverage(weights),
          latest_weight: weights.length ? weights[weights.length - 1].value : null,
          avg_kcal: average(loggedDays.map((r) => r.kcal!)),
          avg_burned: average(rows.filter((r) => r.burned !== null).map((r) => r.burned!)),
          avg_sleep_hours: average(
            rows.filter((r) => r.sleep_hours !== null).map((r) => r.sleep_hours!),
          ),
          days_logged: loggedDays.length,
          days_under_budget: loggedDays.filter((r) => r.kcal! <= user.daily_kcal_budget).length,
          window_compliance: complianceRate(
            windowDays.length,
            windowDays.filter((r) => r.window_compliant).length,
          ),
          goals_review_rate: complianceRate(rows.length, reviewedDays.length),
          goals_review_streak: currentStreak(range, new Set(reviewedDays.map((r) => r.day))),
        },
      };
    },
  );
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
