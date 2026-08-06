import { describe, it, expect } from 'vitest';
import {
  estimateKcal,
  summarizeBurn,
  netIntake,
  isActivity,
  ACTIVITIES,
  NET_INTAKE_FLOOR,
} from '../domain/exercise';

describe('estimateKcal', () => {
  it('estimates a 30 minute run at the starting weight from the goals note', () => {
    // 195 lb = 88.5 kg. 9.8 MET × 3.5 × 88.5 / 200 = 15.2 kcal/min × 30 ≈ 455.
    expect(estimateKcal('running', 30, 195)).toBe(455);
  });

  it('estimates an hour of climbing', () => {
    expect(estimateKcal('climbing', 60, 195)).toBe(743);
  });

  it('estimates a weights session', () => {
    expect(estimateKcal('weights', 45, 195)).toBe(348);
  });

  it('burns less at a lower body weight', () => {
    const at195 = estimateKcal('running', 30, 195);
    const at170 = estimateKcal('running', 30, 170);

    expect(at170).toBeLessThan(at195);
    // The ratio should track the weight ratio.
    expect(at170 / at195).toBeCloseTo(170 / 195, 2);
  });

  it('scales linearly with time', () => {
    expect(estimateKcal('running', 60, 195)).toBeCloseTo(estimateKcal('running', 30, 195) * 2, 0);
  });

  it('ranks the activities the way the MET table does', () => {
    const minutes = 60;
    const weight = 195;

    expect(estimateKcal('running', minutes, weight)).toBeGreaterThan(
      estimateKcal('climbing', minutes, weight),
    );
    expect(estimateKcal('climbing', minutes, weight)).toBeGreaterThan(
      estimateKcal('weights', minutes, weight),
    );
    expect(estimateKcal('weights', minutes, weight)).toBeGreaterThan(
      estimateKcal('walking', minutes, weight),
    );
  });

  it('returns zero for zero or negative minutes', () => {
    expect(estimateKcal('running', 0, 195)).toBe(0);
    expect(estimateKcal('running', -10, 195)).toBe(0);
  });

  it('refuses to guess without a body weight', () => {
    expect(() => estimateKcal('running', 30, 0)).toThrow(/body weight/);
    expect(() => estimateKcal('running', 30, NaN)).toThrow(/body weight/);
  });
});

describe('isActivity', () => {
  it('accepts every activity in the table', () => {
    for (const id of Object.keys(ACTIVITIES)) {
      expect(isActivity(id)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isActivity('quidditch')).toBe(false);
    expect(isActivity('')).toBe(false);
    expect(isActivity('constructor')).toBe(false);
  });
});

describe('summarizeBurn', () => {
  it('adds up a day and keeps estimated and measured apart', () => {
    const summary = summarizeBurn([
      { kcal: 455, source: 'estimated' },
      { kcal: 500, source: 'measured' },
    ]);

    expect(summary).toEqual({ total: 955, estimated: 455, measured: 500, measuredShare: 52 });
  });

  it('reports zeros for a rest day', () => {
    expect(summarizeBurn([])).toEqual({
      total: 0,
      estimated: 0,
      measured: 0,
      measuredShare: 0,
    });
  });

  it('reports a fully measured day as 100 percent', () => {
    expect(summarizeBurn([{ kcal: 600, source: 'measured' }]).measuredShare).toBe(100);
  });

  it('reports a fully estimated day as 0 percent', () => {
    expect(summarizeBurn([{ kcal: 600, source: 'estimated' }]).measuredShare).toBe(0);
  });
});

describe('netIntake', () => {
  it('subtracts exercise from intake', () => {
    expect(netIntake(2400, 960)).toEqual({ net: 1440, tooLow: false });
  });

  it('flags a day where the deficit leaves net intake too low', () => {
    // The exact scenario the goals note warns about: a big training day against a
    // light eating day.
    expect(netIntake(1800, 960).tooLow).toBe(true);
  });

  it('does not flag exactly at the floor', () => {
    expect(netIntake(NET_INTAKE_FLOOR, 0).tooLow).toBe(false);
  });

  it('flags one calorie below the floor', () => {
    expect(netIntake(NET_INTAKE_FLOOR - 1, 0).tooLow).toBe(true);
  });

  it('does not flag a day with nothing eaten yet', () => {
    // Every morning starts at zero — that is not a warning, it is breakfast pending.
    expect(netIntake(0, 0).tooLow).toBe(false);
    expect(netIntake(0, 500).tooLow).toBe(false);
  });

  it('can go negative on a very heavy training day', () => {
    expect(netIntake(500, 900).net).toBe(-400);
  });
});
