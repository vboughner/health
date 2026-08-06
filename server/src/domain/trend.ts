/**
 * Trend arithmetic. Pure — no database, no clock.
 *
 * The goal is half a pound a week, which is small enough that day-to-day noise
 * (water, timing, scale variance) swamps it. So the trend line matters more than
 * any individual reading, and that is what these functions produce.
 */

export interface Point {
  day: string;
  value: number;
}

/**
 * Least-squares slope through the points, expressed per week.
 *
 * Returns null for fewer than three readings — two points always fit a line
 * perfectly and would report a confident trend from no evidence at all.
 */
export function weeklyTrend(points: Point[]): number | null {
  if (points.length < 3) return null;

  // x is days since the first reading, so the slope comes out per day.
  const origin = dayNumber(points[0].day);
  const xs = points.map((p) => dayNumber(p.day) - origin);
  const ys = points.map((p) => p.value);

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }

  // Every reading on the same day — no time span to measure a trend over.
  if (den === 0) return null;

  return round2((num / den) * 7);
}

/**
 * Centred moving average, used to draw a smoothed weight line through noisy
 * daily readings. Windows shrink at the ends rather than dropping points, so the
 * smoothed series always covers the same days as the input.
 */
export function movingAverage(points: Point[], window = 7): Point[] {
  if (points.length === 0) return [];

  const half = Math.floor(window / 2);

  return points.map((p, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(points.length - 1, i + half);

    let sum = 0;
    for (let j = from; j <= to; j++) sum += points[j].value;

    return { day: p.day, value: round2(sum / (to - from + 1)) };
  });
}

/**
 * Longest run of consecutive days ending at the last day in the range.
 *
 * Counting back from the end rather than finding the longest run anywhere is the
 * point: a streak you broke last week is over, however long it was.
 */
export function currentStreak(days: string[], met: Set<string>): number {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (!met.has(days[i])) break;
    streak++;
  }
  return streak;
}

/** Share of days meeting a condition, as a whole percentage. Zero days reads as 0. */
export function complianceRate(total: number, met: number): number {
  return total > 0 ? Math.round((met / total) * 100) : 0;
}

function dayNumber(day: string): number {
  return Math.round(new Date(`${day}T12:00:00Z`).getTime() / 86_400_000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
