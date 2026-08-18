import { describe, it, expect } from 'vitest';
import {
  toGrams,
  nutritionForGrams,
  sumNutrition,
  macroSplit,
  quickNutrition,
  unaccountedKcal,
} from '../domain/nutrition';

// Real USDA per-100g figures, so the numbers below are checkable against reality.
const BANANA = { kcal_per_100g: 89, protein_g: 1.09, fat_g: 0.33, carb_g: 22.8 };
const BROWN_RICE = { kcal_per_100g: 123, protein_g: 2.74, fat_g: 0.97, carb_g: 25.6 };

describe('toGrams', () => {
  it('passes grams through', () => {
    expect(toGrams(150, 'g')).toBe(150);
  });

  it('converts ounces', () => {
    expect(toGrams(1, 'oz')).toBeCloseTo(28.35, 2);
    expect(toGrams(4, 'oz')).toBeCloseTo(113.4, 1);
  });

  it('multiplies servings by the food serving size', () => {
    expect(toGrams(2, 'serving', 118)).toBe(236);
  });

  it('handles fractional servings', () => {
    expect(toGrams(0.5, 'serving', 118)).toBe(59);
  });

  it('refuses servings for a food with no serving size on record', () => {
    expect(() => toGrams(1, 'serving', null)).toThrow(/no serving size/);
    expect(() => toGrams(1, 'serving', 0)).toThrow(/no serving size/);
  });

  it('refuses weight for a food whose serving is defined by its calories', () => {
    // Its grams are a bookkeeping 100 per serving, not something anyone measured,
    // so weighing out 50 g of it would be inventing a number.
    expect(() => toGrams(50, 'g', 100, true)).toThrow(/no weight on record/);
    expect(() => toGrams(2, 'oz', 100, true)).toThrow(/no weight on record/);
  });

  it('still counts servings of one, at the nominal 100 g a serving', () => {
    // 2 servings of a 320-cal food is 200 g at 320 kcal/100g — exactly 640.
    expect(toGrams(2, 'serving', 100, true)).toBe(200);
    expect(
      nutritionForGrams({ kcal_per_100g: 320, protein_g: 0, fat_g: 0, carb_g: 0 }, 200).kcal,
    ).toBe(640);
  });

  it('rejects a negative or non-numeric quantity', () => {
    expect(() => toGrams(-1, 'g')).toThrow(/Invalid quantity/);
    expect(() => toGrams(NaN, 'g')).toThrow(/Invalid quantity/);
  });

  it('allows zero', () => {
    expect(toGrams(0, 'g')).toBe(0);
  });
});

describe('nutritionForGrams', () => {
  it('scales per-100g facts to the amount eaten', () => {
    // One medium banana, 118 g.
    expect(nutritionForGrams(BANANA, 118)).toEqual({
      kcal: 105,
      protein_g: 1.3,
      fat_g: 0.4,
      carb_g: 26.9,
    });
  });

  it('is exact at 100 g', () => {
    expect(nutritionForGrams(BROWN_RICE, 100)).toEqual({
      kcal: 123,
      protein_g: 2.7,
      fat_g: 1,
      carb_g: 25.6,
    });
  });

  it('returns zeros for zero grams', () => {
    expect(nutritionForGrams(BANANA, 0)).toEqual({ kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 });
  });

  it('scales linearly', () => {
    const one = nutritionForGrams(BROWN_RICE, 100);
    const two = nutritionForGrams(BROWN_RICE, 200);
    expect(two.kcal).toBeCloseTo(one.kcal * 2, 1);
  });
});

describe('sumNutrition', () => {
  it('adds a day of entries', () => {
    const day = [
      nutritionForGrams(BANANA, 118),
      nutritionForGrams(BROWN_RICE, 195),
      nutritionForGrams(BANANA, 118),
    ];

    const total = sumNutrition(day);
    expect(total.kcal).toBeCloseTo(449.9, 1);
    expect(total.protein_g).toBeCloseTo(7.9, 1);
  });

  it('returns zeros for an empty day', () => {
    expect(sumNutrition([])).toEqual({ kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 });
  });

  it('does not accumulate floating point noise', () => {
    const entries = Array.from({ length: 10 }, () => ({
      kcal: 0.1,
      protein_g: 0.1,
      fat_g: 0.1,
      carb_g: 0.1,
    }));
    expect(sumNutrition(entries).kcal).toBe(1);
  });
});

describe('macroSplit', () => {
  it('splits by calories, not by grams', () => {
    // 10 g of each. By grams that would be a three-way tie; by calories fat wins
    // because it carries 9 kcal/g against 4.
    const split = macroSplit({ kcal: 170, protein_g: 10, fat_g: 10, carb_g: 10 });

    expect(split.fat).toBeGreaterThan(split.protein);
    expect(split.protein).toBeCloseTo(split.carb, 5);
    expect(split.fat).toBeCloseTo(52.9, 1);
  });

  it('always adds to 100', () => {
    const split = macroSplit({ kcal: 449, protein_g: 7.9, fat_g: 2.3, carb_g: 81.7 });
    expect(split.protein + split.fat + split.carb).toBeCloseTo(100, 0);
  });

  it('returns zeros for an empty day rather than dividing by zero', () => {
    expect(macroSplit({ kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 })).toEqual({
      protein: 0,
      fat: 0,
      carb: 0,
    });
  });

  it('handles a single macro', () => {
    expect(macroSplit({ kcal: 400, protein_g: 100, fat_g: 0, carb_g: 0 })).toEqual({
      protein: 100,
      fat: 0,
      carb: 0,
    });
  });

  it('ignores the calorie figure when it disagrees with the macros', () => {
    // USDA rounding routinely makes these disagree; the split should still be sane.
    const split = macroSplit({ kcal: 9999, protein_g: 10, fat_g: 0, carb_g: 10 });
    expect(split.protein).toBeCloseTo(50, 1);
    expect(split.carb).toBeCloseTo(50, 1);
  });
});

describe('quickNutrition', () => {
  it('records the calories and leaves the macros at zero', () => {
    expect(quickNutrition(720)).toEqual({ kcal: 720, protein_g: 0, fat_g: 0, carb_g: 0 });
  });

  it('rounds to a tenth like every other figure', () => {
    expect(quickNutrition(190.44).kcal).toBe(190.4);
  });

  it('rejects a figure that is not a positive number', () => {
    expect(() => quickNutrition(0)).toThrow(/positive/i);
    expect(() => quickNutrition(-5)).toThrow(/positive/i);
    expect(() => quickNutrition(Number.NaN)).toThrow(/positive/i);
    expect(() => quickNutrition(Number.POSITIVE_INFINITY)).toThrow(/positive/i);
  });
});

describe('unaccountedKcal', () => {
  const known = { kcal: 310, macros_unknown: false };
  const quick = { kcal: 720, macros_unknown: true };

  it('sums only the entries whose macros were never recorded', () => {
    expect(unaccountedKcal([known, quick, { kcal: 190, macros_unknown: true }])).toBe(910);
  });

  it('is zero for a day of ordinary foods', () => {
    expect(unaccountedKcal([known, { kcal: 400, macros_unknown: false }])).toBe(0);
  });

  it('is zero for an empty day', () => {
    expect(unaccountedKcal([])).toBe(0);
  });

  it('rounds the sum to a tenth', () => {
    expect(unaccountedKcal([{ kcal: 0.15, macros_unknown: true }])).toBe(0.2);
  });
});
