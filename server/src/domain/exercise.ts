/**
 * Estimating calories burned. Pure — no database, no clock.
 *
 * The standard MET formula: kcal/min = MET × 3.5 × kg / 200. It is an estimate and
 * nothing more, which is why a watch reading always wins when one is available.
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

export interface BurnSummary {
  total: number;
  estimated: number;
  measured: number;
  /** Share of the total that came from a watch rather than the MET table. */
  measuredShare: number;
}

/**
 * Roll up a day's exercise, keeping estimated and measured apart so the trend can
 * show how much of the burn figure is actually observed.
 */
export function summarizeBurn(
  entries: { kcal: number; source: 'estimated' | 'measured' }[],
): BurnSummary {
  let estimated = 0;
  let measured = 0;

  for (const e of entries) {
    if (e.source === 'measured') measured += e.kcal;
    else estimated += e.kcal;
  }

  const total = Math.round(estimated + measured);

  return {
    total,
    estimated: Math.round(estimated),
    measured: Math.round(measured),
    measuredShare: total > 0 ? Math.round((measured / total) * 100) : 0,
  };
}
