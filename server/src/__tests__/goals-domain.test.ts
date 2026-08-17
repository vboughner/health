import { describe, it, expect } from 'vitest';
import { DEFAULT_GOALS, validateGoals, goalsForDay, type GoalPeriod } from '../domain/goals';

function period(effective_from: string, kcal_budget = 2400): GoalPeriod {
  return {
    effective_from,
    kcal_budget,
    burn_target: 960,
    window_start: '09:00',
    window_end: '19:00',
  };
}

describe('DEFAULT_GOALS', () => {
  it('is what migration 001 used as column defaults', () => {
    expect(DEFAULT_GOALS).toEqual({
      kcal_budget: 2400,
      burn_target: 960,
      window_start: '09:00',
      window_end: '19:00',
    });
  });
});

describe('validateGoals', () => {
  it('accepts the defaults', () => {
    expect(validateGoals(DEFAULT_GOALS)).toBeNull();
  });

  it('rejects a budget outside the sane range', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 499 })).toContain('budget');
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 10001 })).toContain('budget');
  });

  it('rejects a burn target outside the sane range', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: -1 })).toContain('Burn');
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: 5001 })).toContain('Burn');
  });

  it('accepts the range edges themselves', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 500 })).toBeNull();
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 10000 })).toBeNull();
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: 0 })).toBeNull();
    expect(validateGoals({ ...DEFAULT_GOALS, burn_target: 5000 })).toBeNull();
  });

  it.each(['9:00', '09:60', '0900', 'morning', ''])('rejects %s as a time', (bad) => {
    expect(validateGoals({ ...DEFAULT_GOALS, window_start: bad })).toContain('HH:MM');
  });

  it('rejects a window that ends before it starts', () => {
    // domain/day.ts compares minutes-since-midnight and has no concept of a window
    // that wraps past midnight. Saying so here is what stops one being stored.
    const backwards = { ...DEFAULT_GOALS, window_start: '19:00', window_end: '09:00' };
    expect(validateGoals(backwards)).toContain('after');
  });

  it('rejects a zero-length window', () => {
    expect(
      validateGoals({ ...DEFAULT_GOALS, window_start: '09:00', window_end: '09:00' }),
    ).toContain('after');
  });

  it('rejects anything that is not an object of the right shape', () => {
    expect(validateGoals(null)).not.toBeNull();
    expect(validateGoals('2400')).not.toBeNull();
    expect(validateGoals({ kcal_budget: 2400 })).not.toBeNull();
  });

  it('rejects a non-integer budget', () => {
    expect(validateGoals({ ...DEFAULT_GOALS, kcal_budget: 2400.5 })).toContain('whole');
  });
});

describe('goalsForDay', () => {
  const periods = [period('2026-01-01', 2400), period('2026-06-01', 2200)];

  it('takes the latest period starting on or before the day', () => {
    expect(goalsForDay(periods, '2026-05-31').kcal_budget).toBe(2400);
    expect(goalsForDay(periods, '2026-08-16').kcal_budget).toBe(2200);
  });

  it('counts the first day of a period as inside it', () => {
    expect(goalsForDay(periods, '2026-06-01').kcal_budget).toBe(2200);
  });

  it('falls back to the earliest period for a day before all of them', () => {
    // seed-demo backdates six weeks of history behind the account creation date.
    // Those days are judged by the oldest goals on record rather than by nothing.
    expect(goalsForDay(periods, '2025-12-25').kcal_budget).toBe(2400);
  });

  it('does not care what order the periods arrive in', () => {
    expect(goalsForDay([...periods].reverse(), '2026-08-16').kcal_budget).toBe(2200);
  });

  it('returns the defaults when a user somehow has no periods at all', () => {
    // Should not happen — createUser seeds one — but a 500 on the day screen is a
    // worse answer than the numbers the account would have been created with.
    expect(goalsForDay([], '2026-08-16')).toEqual({
      effective_from: '2026-08-16',
      ...DEFAULT_GOALS,
    });
  });

  it('reports which period it chose, so a correction knows what to update', () => {
    expect(goalsForDay(periods, '2026-08-16').effective_from).toBe('2026-06-01');
  });
});
