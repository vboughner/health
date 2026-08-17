import { describe, it, expect } from 'vitest';
import { estimateKcal, isActivity, ACTIVITIES } from '../domain/exercise';

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
