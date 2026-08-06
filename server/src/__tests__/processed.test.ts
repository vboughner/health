import { describe, it, expect } from 'vitest';
import { classify, warningText, THRESHOLDS } from '../domain/processed';

describe('classify', () => {
  describe('whole foods stay clean', () => {
    // USDA Foundation/SR Legacy entries carry no ingredient list at all — this is
    // the bulk of the diet in the goals note and must not throw false warnings.
    it.each([
      ['banana', { added_sugar_g: 0, sodium_mg: 1, ingredients: null }],
      ['brown rice', { added_sugar_g: 0, sodium_mg: 4, ingredients: null }],
      ['black beans', { added_sugar_g: 0, sodium_mg: 1, ingredients: null }],
      ['spinach', { added_sugar_g: 0, sodium_mg: 79, ingredients: null }],
      ['tempeh', { added_sugar_g: null, sodium_mg: 9, ingredients: 'soybeans, water' }],
      ['rolled oats', { added_sugar_g: 0, sodium_mg: 2, ingredients: 'whole grain oats' }],
    ])('%s is unflagged', (_name, food) => {
      expect(classify(food)).toEqual([]);
    });

    it('does not flag a food with nothing known about it', () => {
      expect(classify({})).toEqual([]);
    });
  });

  describe('nutrient thresholds', () => {
    it('flags high added sugar', () => {
      expect(classify({ added_sugar_g: 35 })).toContain('high added sugar');
    });

    it('flags high sodium', () => {
      expect(classify({ sodium_mg: 1200 })).toContain('high sodium');
    });

    it('flags exactly at the threshold', () => {
      expect(classify({ added_sugar_g: THRESHOLDS.addedSugarPer100g })).toContain(
        'high added sugar',
      );
      expect(classify({ sodium_mg: THRESHOLDS.sodiumPer100g })).toContain('high sodium');
    });

    it('does not flag just below the threshold', () => {
      expect(classify({ added_sugar_g: THRESHOLDS.addedSugarPer100g - 0.1 })).toEqual([]);
      expect(classify({ sodium_mg: THRESHOLDS.sodiumPer100g - 1 })).toEqual([]);
    });

    it('treats a null nutrient as unknown, not as zero or as a hit', () => {
      expect(classify({ added_sugar_g: null, sodium_mg: null })).toEqual([]);
    });
  });

  describe('ingredient rules', () => {
    it('flags white bread for refined flour', () => {
      const reasons = classify({
        ingredients: 'Enriched wheat flour, water, yeast, sugar, salt',
      });
      expect(reasons).toContain('refined flour');
    });

    it.each([
      ['high fructose corn syrup', 'water, high fructose corn syrup, citric acid'],
      ['corn syrup', 'sugar, corn syrup, cocoa'],
      ['maltodextrin', 'rice flour, maltodextrin, salt'],
      ['dextrose', 'oats, dextrose, natural flavor'],
    ])('flags %s as refined sugar', (_label, ingredients) => {
      expect(classify({ ingredients })).toContain('refined sugar');
    });

    it('flags hydrogenated fats', () => {
      expect(classify({ ingredients: 'flour, partially hydrogenated soybean oil' })).toContain(
        'hydrogenated fat',
      );
      expect(classify({ ingredients: 'flour, vegetable shortening, salt' })).toContain(
        'hydrogenated fat',
      );
    });

    it.each([
      ['artificial flavor', 'sugar, artificial flavor'],
      ['sodium nitrite', 'pork, salt, sodium nitrite'],
      ['soy protein isolate', 'water, soy protein isolate, canola oil'],
      ['a color number', 'sugar, gelatin, red 40'],
    ])('flags %s as artificial', (_label, ingredients) => {
      expect(classify({ ingredients })).toContain('artificial ingredients');
    });

    it('does not flag whole grain flour as refined', () => {
      expect(classify({ ingredients: 'whole wheat flour, water, yeast, salt' })).toEqual([]);
    });

    it('does not mistake "natural flavor" for "artificial"', () => {
      expect(classify({ ingredients: 'water, natural flavor' })).toEqual([]);
    });

    it('is case-insensitive', () => {
      expect(classify({ ingredients: 'ENRICHED FLOUR, WATER' })).toContain('refined flour');
    });

    it('reports each reason once even when several patterns in a rule match', () => {
      const reasons = classify({ ingredients: 'corn syrup, dextrose, maltodextrin' });
      expect(reasons.filter((r) => r === 'refined sugar')).toHaveLength(1);
    });
  });

  it('stacks every reason for a genuinely bad food', () => {
    const reasons = classify({
      added_sugar_g: 30,
      sodium_mg: 700,
      ingredients: 'enriched flour, high fructose corn syrup, hydrogenated palm oil, red 40',
    });

    expect(reasons).toEqual(
      expect.arrayContaining([
        'high added sugar',
        'high sodium',
        'refined flour',
        'refined sugar',
        'hydrogenated fat',
        'artificial ingredients',
      ]),
    );
  });
});

describe('warningText', () => {
  it('is empty when nothing is flagged', () => {
    expect(warningText([])).toBe('');
  });

  it('reads naturally for one reason', () => {
    expect(warningText(['high added sugar'])).toContain('flagged for high added sugar');
  });

  it('reads naturally for two reasons', () => {
    expect(warningText(['refined flour', 'high sodium'])).toContain(
      'refined flour and high sodium',
    );
  });

  it('reads naturally for three or more', () => {
    expect(warningText(['a', 'b', 'c'])).toContain('a, b and c');
  });

  it('nudges rather than scolds', () => {
    const text = warningText(['high added sugar']);
    expect(text).toMatch(/Heads up/);
    expect(text).toMatch(/next time/);
  });
});
