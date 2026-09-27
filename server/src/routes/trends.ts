import type { FastifyInstance } from 'fastify';
import type { AppOptions } from '../app';
import { localDay, addDays, dayRange, eatingWindow, sleepHours } from '../domain/day';
import {
  weeklyTrend,
  movingAverage,
  currentStreak,
  complianceRate,
  weeklySessions,
} from '../domain/trend';
import { goalsForDay } from '../domain/goals';
import {
  foodTotalsByDay,
  burnByDay,
  dailyEntriesInRange,
  listGoalPeriods,
  weightsDays,
} from '../store';

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
      // One extra day back: a night's hours pair the previous evening's bedtime
      // with this morning's wake time.
      const entries = new Map(
        dailyEntriesInRange(opts.db, user.id, addDays(from, -1), today).map((r) => [
          r.local_day,
          r,
        ]),
      );

      // Loaded once for the whole range rather than per day. A range can span more than
      // one set of goals, and every day must be judged by its own.
      const periods = listGoalPeriods(opts.db, user.id);

      const recordedDays = new Set<string>();

      const rows = range.map((day) => {
        const goals = goalsForDay(periods, day);
        const food = foodByDay.get(day);
        const entry = entries.get(day);

        // A day with no record of any kind was never lived in the app — before the
        // first log, or a stretch that went untouched. Reporting those as "not
        // reviewed" paints them a failing red, which is a judgement about days that
        // predate the question. A day with anything on it did happen, so an absent
        // review there is a real miss and stays false.
        const hasRecord = Boolean(food || burn.get(day) || entry);
        if (hasRecord) recordedDays.add(day);

        const window = food
          ? eatingWindow(
              [food.first_eaten_at!, food.last_eaten_at!],
              user.timezone,
              goals.window_start,
              goals.window_end,
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
          sleep_hours: sleepHours(
            entries.get(addDays(day, -1))?.sleep_start ?? null,
            entry?.sleep_end ?? null,
          ),
          window_first: window?.first ?? null,
          window_last: window?.last ?? null,
          window_compliant: window?.compliant ?? null,
          goals_reviewed: hasRecord ? (entry?.goals_reviewed ?? false) : null,
          budget: goals.kcal_budget,
          protein_min_g: goals.protein_min_g,
          protein_max_g: goals.protein_max_g,
        };
      });

      const weights = rows
        .filter((r) => r.weight_lb !== null)
        .map((r) => ({ day: r.day, value: r.weight_lb! }));

      const loggedDays = rows.filter((r) => r.kcal !== null);
      const windowDays = rows.filter((r) => r.window_compliant !== null);
      // Same denominator the strip draws cells for, so the percentage beside it
      // counts the same days you can see.
      const reviewKnownDays = rows.filter((r) => r.goals_reviewed !== null);
      const reviewedDays = rows.filter((r) => r.goals_reviewed);
      const current = goalsForDay(periods, today);

      // Only logged days with a target in force are judged — a day before the target
      // existed is not a miss, and neither is a day with nothing logged.
      const proteinJudged = loggedDays.filter((r) => r.protein_min_g !== null);
      const proteinInRange = proteinJudged.filter(
        (r) => r.protein_g! >= r.protein_min_g! && r.protein_g! <= r.protein_max_g!,
      );

      return {
        from,
        to: today,
        days: rows,
        budget: current.kcal_budget,
        burn_target: current.burn_target,
        weights_per_week: current.weights_per_week,
        weights_weeks: weeklySessions(
          range,
          new Set(weightsDays(opts.db, user.id, from, today)),
          recordedDays,
          (day) => goalsForDay(periods, day).weights_per_week,
          today,
        ),
        summary: {
          weight_trend_per_week: weeklyTrend(weights),
          weight_smoothed: movingAverage(weights),
          latest_weight: weights.length ? weights[weights.length - 1].value : null,
          avg_kcal: average(loggedDays.map((r) => r.kcal!)),
          avg_protein_g: average(loggedDays.map((r) => r.protein_g!)),
          protein_days_with_target: proteinJudged.length,
          protein_days_in_range: proteinInRange.length,
          avg_burned: average(rows.filter((r) => r.burned !== null).map((r) => r.burned!)),
          avg_sleep_hours: average(
            rows.filter((r) => r.sleep_hours !== null).map((r) => r.sleep_hours!),
          ),
          days_logged: loggedDays.length,
          days_under_budget: loggedDays.filter((r) => r.kcal! <= r.budget).length,
          window_compliance: complianceRate(
            windowDays.length,
            windowDays.filter((r) => r.window_compliant).length,
          ),
          goals_review_rate: complianceRate(reviewKnownDays.length, reviewedDays.length),
          // The rate is meaningless without the denominator: "100%" reads very
          // differently over one day than over thirty, and early on it is one day.
          goals_review_days: reviewKnownDays.length,
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
