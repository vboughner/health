import { describe, it, expect } from 'vitest';
import { estimateKcal, isActivity, rescaleBurn, ACTIVITIES } from '../domain/exercise';

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

describe('rescaleBurn', () => {
  /** A 30 minute run logged at 195 lb: 455 cal, as the first test above establishes. */
  const run30 = { activity: 'running', minutes: 30, kcal: 455 };

  it('scales with the minutes', () => {
    expect(rescaleBurn(run30, { activity: 'running', minutes: 45 })).toBe(683);
    expect(rescaleBurn(run30, { activity: 'running', minutes: 15 })).toBe(228);
  });

  it('scales with the MET when the activity changes', () => {
    // Walking is 3.5 against running's 9.8. Lands a hair under 162.5 in binary
    // floating point, so it rounds down rather than up.
    expect(rescaleBurn(run30, { activity: 'walking', minutes: 30 })).toBe(162);
  });

  it('scales with both at once', () => {
    expect(rescaleBurn(run30, { activity: 'weights', minutes: 60 })).toBe(464);
  });

  it('leaves an unchanged edit exactly where it was', () => {
    // The proof that the body weight the entry was priced at survives a round trip:
    // there is no weight in this call to get wrong.
    expect(rescaleBurn(run30, { activity: 'running', minutes: 30 })).toBe(455);
  });

  it('prices an edit at the original body weight, not a later one', () => {
    // Logged at 170 lb, then edited. Re-estimating at 195 would give a bigger number;
    // scaling the snapshot must agree with the original weight instead.
    const at170 = {
      activity: 'running' as const,
      minutes: 30,
      kcal: estimateKcal('running', 30, 170),
    };
    const scaled = rescaleBurn(at170, { activity: 'running', minutes: 60 });

    // Within a calorie of re-estimating at the weight it was logged at. Not exact:
    // the snapshot was already rounded, and scaling a rounded figure rounds again.
    expect(Math.abs(scaled - estimateKcal('running', 60, 170))).toBeLessThanOrEqual(1);

    // And nowhere near what a later, heavier weight would have priced it at — which
    // is what re-estimating on edit would have done.
    expect(scaled).toBeLessThan(estimateKcal('running', 60, 195) - 50);
  });

  // These assert the message, not merely that something was thrown: before the
  // function exists every one of them passes on the TypeError from calling undefined,
  // which is a green that proves nothing.
  it('refuses an entry with nothing to scale from', () => {
    expect(() =>
      rescaleBurn({ ...run30, minutes: 0 }, { activity: 'running', minutes: 30 }),
    ).toThrow(/nothing to scale/);
    expect(() => rescaleBurn({ ...run30, kcal: 0 }, { activity: 'running', minutes: 30 })).toThrow(
      /nothing to scale/,
    );
  });

  it('refuses a stored activity that is no longer in the table', () => {
    expect(() =>
      rescaleBurn(
        { activity: 'kayaking', minutes: 30, kcal: 455 },
        { activity: 'running', minutes: 30 },
      ),
    ).toThrow(/kayaking/);
  });

  it('refuses minutes that are not a positive number', () => {
    expect(() => rescaleBurn(run30, { activity: 'running', minutes: 0 })).toThrow(/positive/);
    expect(() => rescaleBurn(run30, { activity: 'running', minutes: -5 })).toThrow(/positive/);
  });
});

describe('hiking', () => {
  it('is an activity, at the Compendium cross-country MET', () => {
    expect(isActivity('hiking')).toBe(true);
    expect(ACTIVITIES.hiking).toEqual({ label: 'Hiking', met: 6.0 });
  });

  it('sits right after climbing in the picker', () => {
    const ids = Object.keys(ACTIVITIES);
    expect(ids.indexOf('hiking')).toBe(ids.indexOf('climbing') + 1);
  });
});
