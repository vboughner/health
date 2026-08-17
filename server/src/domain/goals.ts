/**
 * What you are aiming at, and when you were aiming at it.
 *
 * The numbers are effective-dated rather than current-only. The eating window is
 * derived per request from food timestamps, so evaluating it against whatever the
 * setting says *today* would let widening the window retroactively un-violate every
 * past day — right for fixing a typo, wrong for a real schedule change. The same is
 * true of the budget: trends counts days at or under it.
 *
 * So each day is judged by the period covering it, and editing says which of the two
 * it meant. See routes/settings.ts.
 */

export interface Goals {
  kcal_budget: number;
  burn_target: number;
  /** 24-hour HH:MM, local. */
  window_start: string;
  window_end: string;
}

/** A Goals with the first day it applied to. */
export interface GoalPeriod extends Goals {
  /** YYYY-MM-DD, local day. */
  effective_from: string;
}

/**
 * What an account starts with, from Personal/Mid-2026 Goals.md as it stood in
 * August 2026. These were column defaults in migration 001; with the columns gone
 * they need a home in code, and every new account is seeded from here.
 */
export const DEFAULT_GOALS: Goals = {
  kcal_budget: 2400,
  burn_target: 960,
  window_start: '09:00',
  window_end: '19:00',
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const BUDGET_MIN = 500;
const BUDGET_MAX = 10000;
const BURN_MAX = 5000;

/** Minutes since local midnight. Only ever called on a string HHMM_RE has passed. */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Returns the reason this is not a usable set of goals, or null when it is.
 *
 * A message rather than a thrown error or a boolean, because the route sends it
 * straight back as the 400 body and the form puts it on screen unchanged.
 */
export function validateGoals(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'Expected a set of goals';

  const g = input as Record<string, unknown>;

  if (typeof g.kcal_budget !== 'number' || !Number.isFinite(g.kcal_budget)) {
    return 'Calorie budget must be a number';
  }
  if (!Number.isInteger(g.kcal_budget)) return 'Calorie budget must be a whole number';
  if (g.kcal_budget < BUDGET_MIN || g.kcal_budget > BUDGET_MAX) {
    return `Calorie budget must be between ${BUDGET_MIN} and ${BUDGET_MAX}`;
  }

  if (typeof g.burn_target !== 'number' || !Number.isFinite(g.burn_target)) {
    return 'Burn target must be a number';
  }
  if (!Number.isInteger(g.burn_target)) return 'Burn target must be a whole number';
  if (g.burn_target < 0 || g.burn_target > BURN_MAX) {
    return `Burn target must be between 0 and ${BURN_MAX}`;
  }

  if (typeof g.window_start !== 'string' || !HHMM_RE.test(g.window_start)) {
    return 'Window start must be a time in HH:MM';
  }
  if (typeof g.window_end !== 'string' || !HHMM_RE.test(g.window_end)) {
    return 'Window end must be a time in HH:MM';
  }

  // domain/day.ts compares minutes since midnight and has no notion of a window
  // that wraps. A window that wraps would silently mark every day non-compliant.
  if (minutes(g.window_end) <= minutes(g.window_start)) {
    return 'Window end must be after window start';
  }

  return null;
}

/**
 * The goals in force on a given day: the latest period starting on or before it.
 *
 * Falls back to the earliest period rather than to nothing, so days behind the first
 * period — seed-demo backdates six weeks — are judged by the oldest goals on record
 * instead of failing. No sentinel date is needed anywhere as a result.
 */
export function goalsForDay(periods: GoalPeriod[], day: string): GoalPeriod {
  if (periods.length === 0) return { effective_from: day, ...DEFAULT_GOALS };

  const sorted = [...periods].sort((a, b) => a.effective_from.localeCompare(b.effective_from));

  let chosen = sorted[0];
  for (const p of sorted) {
    if (p.effective_from > day) break;
    chosen = p;
  }

  return chosen;
}
