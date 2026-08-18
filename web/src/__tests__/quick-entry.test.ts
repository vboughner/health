import { describe, it, expect } from 'vitest';
import { formatAmount } from '../screens/Today';
import { coverageNote } from '../components/MacroBar';

const ordinary = { quantity: 1, unit: 'serving', grams: 118, macros_unknown: false };

describe('formatAmount for a calories-only entry', () => {
  it('says what it is instead of quoting a serving nobody measured', () => {
    expect(formatAmount({ ...ordinary, grams: 0, macros_unknown: true })).toBe('calories only');
  });

  it('leaves an ordinary entry alone', () => {
    expect(formatAmount(ordinary)).toBe('1 × serving (118g)');
    expect(formatAmount({ ...ordinary, unit: 'g', quantity: 150 })).toBe('150 g');
  });
});

describe('coverageNote', () => {
  it('names how much of the day the macro split is not speaking for', () => {
    expect(coverageNote(910, 1220)).toBe('910 of 1220 cal have no macros on record');
  });

  it('is absent when every calorie has macros behind it', () => {
    expect(coverageNote(0, 1220)).toBeNull();
  });

  it('rounds, because a tenth of a calorie is not worth saying', () => {
    expect(coverageNote(189.6, 1219.4)).toBe('190 of 1219 cal have no macros on record');
  });
});
