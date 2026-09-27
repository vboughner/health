import { describe, it, expect } from 'vitest';
import {
  weeklyTrend,
  movingAverage,
  currentStreak,
  complianceRate,
  mondayOf,
  weeklySessions,
} from '../domain/trend';
import { dayRange } from '../domain/day';

describe('weeklyTrend', () => {
  it('reports a steady half-pound-a-week loss as -0.5', () => {
    const points = [
      { day: '2026-01-01', value: 195 },
      { day: '2026-01-08', value: 194.5 },
      { day: '2026-01-15', value: 194 },
      { day: '2026-01-22', value: 193.5 },
    ];

    expect(weeklyTrend(points)).toBe(-0.5);
  });

  it('reports a gain as positive', () => {
    const points = [
      { day: '2026-01-01', value: 190 },
      { day: '2026-01-08', value: 191 },
      { day: '2026-01-15', value: 192 },
    ];

    expect(weeklyTrend(points)).toBe(1);
  });

  it('reports a flat line as zero', () => {
    const points = [
      { day: '2026-01-01', value: 195 },
      { day: '2026-01-08', value: 195 },
      { day: '2026-01-15', value: 195 },
    ];

    expect(weeklyTrend(points)).toBe(0);
  });

  it('sees through daily noise to the underlying trend', () => {
    // Losing 0.5 lb/week with ±1 lb of daily scale noise on top.
    const noise = [0.8, -0.6, 0.4, -0.9, 0.5, -0.3, 0.7, -0.5, 0.2, -0.4, 0.6, -0.8, 0.3, -0.1];
    const points = noise.map((n, i) => ({
      day: `2026-01-${String(i + 1).padStart(2, '0')}`,
      value: 195 - (0.5 / 7) * i + n,
    }));

    const trend = weeklyTrend(points)!;
    expect(trend).toBeGreaterThan(-1.2);
    expect(trend).toBeLessThan(0);
  });

  it('returns null for fewer than three readings', () => {
    expect(weeklyTrend([])).toBeNull();
    expect(weeklyTrend([{ day: '2026-01-01', value: 195 }])).toBeNull();
    expect(
      weeklyTrend([
        { day: '2026-01-01', value: 195 },
        { day: '2026-01-08', value: 194 },
      ]),
    ).toBeNull();
  });

  it('returns null when every reading is on the same day', () => {
    expect(
      weeklyTrend([
        { day: '2026-01-01', value: 195 },
        { day: '2026-01-01', value: 194 },
        { day: '2026-01-01', value: 196 },
      ]),
    ).toBeNull();
  });

  it('handles unevenly spaced readings', () => {
    // Weighed on day 1, 2, and 15 — still 0.5 lb/week overall.
    const points = [
      { day: '2026-01-01', value: 195 },
      { day: '2026-01-02', value: 194.93 },
      { day: '2026-01-15', value: 194 },
    ];

    expect(weeklyTrend(points)).toBeCloseTo(-0.5, 1);
  });

  it('is not thrown off by a month boundary', () => {
    const points = [
      { day: '2026-01-29', value: 195 },
      { day: '2026-02-05', value: 194.5 },
      { day: '2026-02-12', value: 194 },
    ];

    expect(weeklyTrend(points)).toBe(-0.5);
  });
});

describe('movingAverage', () => {
  it('smooths a noisy series', () => {
    const points = [
      { day: '2026-01-01', value: 195 },
      { day: '2026-01-02', value: 197 },
      { day: '2026-01-03', value: 193 },
      { day: '2026-01-04', value: 196 },
      { day: '2026-01-05', value: 194 },
    ];

    const smoothed = movingAverage(points, 3);

    // Middle points average their neighbours.
    expect(smoothed[1].value).toBe(195);
    expect(smoothed[2].value).toBeCloseTo(195.33, 2);
  });

  it('covers exactly the same days as the input', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-01-${String(i + 1).padStart(2, '0')}`,
      value: 190 + i,
    }));

    const smoothed = movingAverage(points, 7);

    expect(smoothed).toHaveLength(10);
    expect(smoothed.map((p) => p.day)).toEqual(points.map((p) => p.day));
  });

  it('shrinks the window at the ends rather than dropping points', () => {
    const points = [
      { day: '2026-01-01', value: 10 },
      { day: '2026-01-02', value: 20 },
      { day: '2026-01-03', value: 30 },
    ];

    const smoothed = movingAverage(points, 7);

    expect(smoothed[0].value).toBe(20); // average of all three
    expect(smoothed[2].value).toBe(20);
  });

  it('returns an empty array for no points', () => {
    expect(movingAverage([])).toEqual([]);
  });

  it('leaves a single point alone', () => {
    expect(movingAverage([{ day: '2026-01-01', value: 195 }])).toEqual([
      { day: '2026-01-01', value: 195 },
    ]);
  });
});

describe('currentStreak', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];

  it('counts back from the most recent day', () => {
    expect(currentStreak(days, new Set(['2026-01-03', '2026-01-04', '2026-01-05']))).toBe(3);
  });

  it('is zero when the most recent day was missed', () => {
    // A four-day run that ended yesterday is not a current streak.
    expect(
      currentStreak(days, new Set(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])),
    ).toBe(0);
  });

  it('stops at the first gap', () => {
    expect(currentStreak(days, new Set(['2026-01-01', '2026-01-04', '2026-01-05']))).toBe(2);
  });

  it('counts a perfect run', () => {
    expect(currentStreak(days, new Set(days))).toBe(5);
  });

  it('is zero for an empty range or nothing met', () => {
    expect(currentStreak([], new Set())).toBe(0);
    expect(currentStreak(days, new Set())).toBe(0);
  });
});

describe('complianceRate', () => {
  it('reports a percentage', () => {
    expect(complianceRate(30, 24)).toBe(80);
    expect(complianceRate(7, 7)).toBe(100);
    expect(complianceRate(7, 0)).toBe(0);
  });

  it('reports zero rather than dividing by zero', () => {
    expect(complianceRate(0, 0)).toBe(0);
  });

  it('rounds to a whole percent', () => {
    expect(complianceRate(3, 1)).toBe(33);
  });
});

describe('mondayOf', () => {
  it('finds the Monday of the week, Monday itself included', () => {
    expect(mondayOf('2026-09-21')).toBe('2026-09-21'); // Monday
    expect(mondayOf('2026-09-27')).toBe('2026-09-21'); // Sunday
    expect(mondayOf('2026-09-24')).toBe('2026-09-21'); // Thursday
  });

  it('crosses a month and a year', () => {
    expect(mondayOf('2026-10-01')).toBe('2026-09-28');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });
});

describe('weeklySessions', () => {
  // Mon 2026-09-07 .. Sun 2026-09-27: three whole weeks, today the final Sunday.
  const range = dayRange('2026-09-27', 21);
  const two = () => 2;

  it('counts one session per day, however many entries it had', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-08', '2026-09-10']), two, '2026-09-27');
    expect(weeks[0]).toEqual({ week_start: '2026-09-07', count: 2, target: 2, state: 'met' });
  });

  it('calls a finished week under target missed', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-15']), two, '2026-09-27');
    expect(weeks[1]).toEqual({ week_start: '2026-09-14', count: 1, target: 2, state: 'missed' });
  });

  it('never calls the current week missed', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-22']), two, '2026-09-24');
    expect(weeks[2].state).toBe('in_progress');
  });

  it('calls the current week met as soon as it is', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-22', '2026-09-23']), two, '2026-09-24');
    expect(weeks[2].state).toBe('met');
  });

  it('marks a week the range starts partway through as partial, counting only its days', () => {
    const midweek = dayRange('2026-09-27', 18); // starts Thu 2026-09-10
    const weeks = weeklySessions(midweek, new Set(['2026-09-08', '2026-09-11']), two, '2026-09-27');
    expect(weeks[0]).toEqual({ week_start: '2026-09-07', count: 1, target: 2, state: 'partial' });
    expect(weeks).toHaveLength(3);
  });

  it('judges each week by the target in force on its Monday', () => {
    const targetFor = (day: string) => (day >= '2026-09-21' ? 3 : 1);
    const days = new Set(['2026-09-08', '2026-09-22', '2026-09-23']);
    const weeks = weeklySessions(range, days, targetFor, '2026-09-27');
    expect(weeks.map((w) => [w.target, w.state])).toEqual([
      [1, 'met'],
      [1, 'missed'],
      [3, 'in_progress'],
    ]);
  });

  it('meets a zero target by doing nothing', () => {
    const weeks = weeklySessions(range, new Set(), () => 0, '2026-09-27');
    expect(weeks.every((w) => w.state === 'met')).toBe(true);
  });

  it('shows the count with no verdict where there is no target', () => {
    const weeks = weeklySessions(range, new Set(['2026-09-08']), () => null, '2026-09-27');
    expect(weeks[0]).toEqual({
      week_start: '2026-09-07',
      count: 1,
      target: null,
      state: 'no_target',
    });
  });
});
