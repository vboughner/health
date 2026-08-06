/**
 * Client-side mirror of the server's serving math, used only for the live preview
 * while choosing a quantity. The server recomputes everything on log — this never
 * decides what gets stored.
 */
import type { Pickable, Unit } from './types';

const GRAMS_PER_OZ = 28.3495;

export function toGrams(quantity: number, unit: Unit, servingGrams: number | null): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  switch (unit) {
    case 'g':
      return quantity;
    case 'oz':
      return quantity * GRAMS_PER_OZ;
    case 'serving':
      return servingGrams && servingGrams > 0 ? quantity * servingGrams : null;
  }
}

export interface Preview {
  grams: number;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
}

export function preview(food: Pickable, quantity: number, unit: Unit): Preview | null {
  const grams = toGrams(quantity, unit, food.serving_grams);
  if (grams === null) return null;

  const factor = grams / 100;
  return {
    grams: round1(grams),
    kcal: round1(food.kcal_per_100g * factor),
    protein_g: round1(food.protein_g * factor),
    fat_g: round1(food.fat_g * factor),
    carb_g: round1(food.carb_g * factor),
  };
}

/** Macro split by calories, matching the server. Zeros when there is nothing to split. */
export function macroSplit(m: { protein_g: number; fat_g: number; carb_g: number }) {
  const protein = m.protein_g * 4;
  const fat = m.fat_g * 9;
  const carb = m.carb_g * 4;
  const total = protein + fat + carb;

  if (total <= 0) return { protein: 0, fat: 0, carb: 0 };

  return {
    protein: round1((protein / total) * 100),
    fat: round1((fat / total) * 100),
    carb: round1((carb / total) * 100),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
