import { describe, it, expect } from 'vitest';
import { burnPreview } from '../exercise';
import type { Activity } from '../types';

/** What /activities returns, MET values included. */
const ACTIVITIES: Activity[] = [
  { id: 'running', label: 'Running', met: 9.8 },
  { id: 'walking', label: 'Walking', met: 3.5 },
  { id: 'weights', label: 'Weights', met: 5.0 },
];

/** A 30 minute run logged at 195 lb. */
const run30 = { activity: 'running', minutes: 30, kcal: 455 };

describe('burnPreview', () => {
  it('scales with the minutes', () => {
    expect(burnPreview(run30, 'running', 45, ACTIVITIES)).toBe(683);
    expect(burnPreview(run30, 'running', 15, ACTIVITIES)).toBe(228);
  });

  it('scales with the MET when the activity changes', () => {
    expect(burnPreview(run30, 'walking', 30, ACTIVITIES)).toBe(162);
  });

  it('scales with both at once', () => {
    expect(burnPreview(run30, 'weights', 60, ACTIVITIES)).toBe(464);
  });

  it('leaves an unchanged edit exactly where it was', () => {
    expect(burnPreview(run30, 'running', 30, ACTIVITIES)).toBe(455);
  });

  it('has nothing to show until the minutes are a positive number', () => {
    expect(burnPreview(run30, 'running', 0, ACTIVITIES)).toBeNull();
    expect(burnPreview(run30, 'running', -5, ACTIVITIES)).toBeNull();
    expect(burnPreview(run30, 'running', NaN, ACTIVITIES)).toBeNull();
  });

  it('has nothing to show when an entry has nothing to scale from', () => {
    expect(burnPreview({ ...run30, minutes: 0 }, 'running', 30, ACTIVITIES)).toBeNull();
    expect(burnPreview({ ...run30, kcal: 0 }, 'running', 30, ACTIVITIES)).toBeNull();
  });

  it('has nothing to show for an activity the server did not send', () => {
    expect(burnPreview(run30, 'kayaking', 30, ACTIVITIES)).toBeNull();
    expect(burnPreview({ ...run30, activity: 'kayaking' }, 'running', 30, ACTIVITIES)).toBeNull();
  });
});
