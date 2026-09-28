/**
 * Estimating calories burned. Pure — no database, no clock.
 *
 * The standard MET formula: kcal/min = MET × 3.5 × kg / 200. Every entry is an
 * estimate scaled by body weight — there is no other source of a calorie figure.
 */

/**
 * MET values from the Compendium of Physical Activities, chosen for the activities
 * actually in the plan: running three times a week, climbing twice, one weights
 * session. Middling intensities — a hard interval session burns more than this.
 * The list follows the plan as revised in September 2026: hiking in, running reduced,
 * weights 2–3×.
 */
export const ACTIVITIES = {
  running: { label: 'Running', met: 9.8 },
  climbing: { label: 'Climbing', met: 8.0 },
  // Compendium 17080, "hiking, cross country".
  hiking: { label: 'Hiking', met: 6.0 },
  weights: { label: 'Weights', met: 5.0 },
  walking: { label: 'Walking', met: 3.5 },
  cycling: { label: 'Cycling', met: 7.5 },
  other: { label: 'Other', met: 5.0 },
} as const;

export type ActivityId = keyof typeof ACTIVITIES;

const LB_PER_KG = 2.20462;

export function isActivity(value: string): value is ActivityId {
  return Object.prototype.hasOwnProperty.call(ACTIVITIES, value);
}

/**
 * Estimated calories burned, rounded to a whole number.
 *
 * Weight matters — the same run burns noticeably more at 195 lb than at 170 — so
 * the estimate improves on its own as the weight log fills in.
 */
export function estimateKcal(activity: ActivityId, minutes: number, weightLb: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (!Number.isFinite(weightLb) || weightLb <= 0) {
    throw new Error('A body weight is needed to estimate calories burned');
  }

  const kg = weightLb / LB_PER_KG;
  const met = ACTIVITIES[activity].met;

  return Math.round(((met * 3.5 * kg) / 200) * minutes);
}

/**
 * What an entry's calories become when its activity or its minutes are corrected.
 *
 * Derived from the entry's own snapshot, never re-estimated. `estimateKcal` scales by
 * body weight, and body weight is meant to change — so re-running it on edit would
 * re-price a workout from March at what you weigh today. Scaling instead keeps the
 * weight the entry was logged at, without ever needing to know what it was: the MET
 * formula is linear in both MET and minutes, so multiplying by the two ratios gives
 * exactly what `estimateKcal` would have returned at that same original weight.
 *
 * Rounded, as `estimateKcal` is, so repeated edits can drift a calorie or two. That is
 * well inside the error of an estimate scaled by an estimated weight.
 */
export function rescaleBurn(
  entry: { activity: string; minutes: number; kcal: number },
  next: { activity: ActivityId; minutes: number },
): number {
  if (!Number.isFinite(next.minutes) || next.minutes <= 0) {
    throw new Error('Minutes must be a positive number');
  }
  // Refused rather than guessed: an activity dropped from the table after something
  // was logged against it has no MET to scale from, and a silently wrong calorie
  // figure is worse than a correction that will not save.
  if (!isActivity(entry.activity)) {
    throw new Error(`No MET on file for "${entry.activity}"`);
  }
  if (!(entry.minutes > 0) || !(entry.kcal > 0)) {
    throw new Error('This entry has nothing to scale from');
  }

  const metRatio = ACTIVITIES[next.activity].met / ACTIVITIES[entry.activity].met;
  return Math.round(entry.kcal * metRatio * (next.minutes / entry.minutes));
}
