import { describe, it, expect } from 'vitest';
import { toGrams, preview, macroSplit } from '../nutrition';
import type { Pickable } from '../types';

const BANANA = {
  source_id: '1',
  name: 'Bananas, raw',
  brand: null,
  serving_desc: null,
  serving_grams: null,
  kcal_per_100g: 89,
  protein_g: 1.09,
  fat_g: 0.33,
  carb_g: 22.8,
  added_sugar_g: null,
  sodium_mg: null,
  ingredients: null,
} satisfies Pickable;

const COOKIE = { ...BANANA, serving_grams: 32, kcal_per_100g: 500 };

describe('toGrams', () => {
  it('handles each unit', () => {
    expect(toGrams(150, 'g', null)).toBe(150);
    expect(toGrams(1, 'oz', null)).toBeCloseTo(28.35, 2);
    expect(toGrams(2, 'serving', 32)).toBe(64);
  });

  it('returns null rather than guessing when there is no serving size', () => {
    expect(toGrams(1, 'serving', null)).toBeNull();
    expect(toGrams(1, 'serving', 0)).toBeNull();
  });

  it('returns null for an empty or invalid amount', () => {
    expect(toGrams(0, 'g', null)).toBeNull();
    expect(toGrams(-1, 'g', null)).toBeNull();
    expect(toGrams(NaN, 'g', null)).toBeNull();
  });
});

describe('preview', () => {
  it('matches what the server will compute for the same input', () => {
    // Same expectation as the server's nutrition test for a 118 g banana.
    expect(preview(BANANA, 118, 'g')).toEqual({
      grams: 118,
      kcal: 105,
      protein_g: 1.3,
      fat_g: 0.4,
      carb_g: 26.9,
    });
  });

  it('scales by serving', () => {
    expect(preview(COOKIE, 2, 'serving')).toMatchObject({ grams: 64, kcal: 320 });
  });

  it('returns null when the amount cannot be resolved', () => {
    expect(preview(BANANA, 1, 'serving')).toBeNull();
    expect(preview(BANANA, 0, 'g')).toBeNull();
  });
});

describe('macroSplit', () => {
  it('splits by calories, so fat outweighs equal grams of the others', () => {
    const split = macroSplit({ protein_g: 10, fat_g: 10, carb_g: 10 });

    expect(split.fat).toBeCloseTo(52.9, 1);
    expect(split.protein).toBeCloseTo(split.carb, 5);
  });

  it('returns zeros for an empty day', () => {
    expect(macroSplit({ protein_g: 0, fat_g: 0, carb_g: 0 })).toEqual({
      protein: 0,
      fat: 0,
      carb: 0,
    });
  });

  it('adds to 100', () => {
    const split = macroSplit({ protein_g: 7.9, fat_g: 2.3, carb_g: 81.7 });
    expect(split.protein + split.fat + split.carb).toBeCloseTo(100, 0);
  });
});
