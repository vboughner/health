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
 */
export const ACTIVITIES = {
  running: { label: 'Running', met: 9.8 },
  climbing: { label: 'Climbing', met: 8.0 },
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
