import { describe, it, expect } from 'vitest';
import { editPreview } from '../nutrition';

/** Two servings of a cookie, as an entry snapshotted it. */
const entry = {
  quantity: 2,
  grams: 64,
  kcal: 320,
  protein_g: 3.2,
  fat_g: 16,
  carb_g: 41.6,
};

describe('editPreview', () => {
  it('scales grams, calories and macros from a typed amount', () => {
    expect(editPreview(entry, 'quantity', 3)).toEqual({
      quantity: 3,
      grams: 96,
      kcal: 480,
      protein_g: 4.8,
      fat_g: 24,
      carb_g: 62.4,
    });
  });

  it('back-solves the amount from typed calories', () => {
    expect(editPreview(entry, 'kcal', 400)).toEqual({
      quantity: 2.5,
      grams: 80,
      kcal: 400,
      protein_g: 4,
      fat_g: 20,
      carb_g: 52,
    });
  });

  it('keeps the typed figure exactly, so the box you are in does not jump', () => {
    expect(editPreview(entry, 'kcal', 333)?.kcal).toBe(333);
    expect(editPreview(entry, 'quantity', 1.7)?.quantity).toBe(1.7);
  });

  it('rounds the amount finer than the figures, because a quarter serving is real', () => {
    // 100 of 320 is a bit under a third of what was logged: 0.625 servings.
    expect(editPreview(entry, 'kcal', 100)).toMatchObject({ quantity: 0.625, grams: 20 });
  });

  it('is nothing at all for an amount that is not a positive number', () => {
    expect(editPreview(entry, 'quantity', 0)).toBeNull();
    expect(editPreview(entry, 'quantity', -1)).toBeNull();
    expect(editPreview(entry, 'quantity', Number.NaN)).toBeNull();
    expect(editPreview(entry, 'kcal', 0)).toBeNull();
  });

  it('cannot back-solve an entry that cost no calories', () => {
    const coffee = { quantity: 250, grams: 250, kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 };
    expect(editPreview(coffee, 'kcal', 400)).toBeNull();
    // The amount still works: it is the calories that have nothing to scale.
    expect(editPreview(coffee, 'quantity', 500)).toMatchObject({ grams: 500, kcal: 0 });
  });

  it('cannot scale an entry that has no amount', () => {
    const quick = { quantity: 0, grams: 0, kcal: 720, protein_g: 0, fat_g: 0, carb_g: 0 };
    expect(editPreview(quick, 'quantity', 2)).toBeNull();
  });
});
