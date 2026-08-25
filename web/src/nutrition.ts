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

/** The figures a logged entry snapshotted, which an edit scales. */
export interface Scalable {
  quantity: number;
  grams: number;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
}

/**
 * What an entry becomes when you type into one of the two boxes that describe it.
 *
 * The amount and the calories are two spellings of one number: each sets the
 * other, so the sheet shows both and the server is told whichever was typed. Like
 * `preview` above, this decides nothing — it scales what the entry recorded so the
 * correction is an informed one, and the server does the same arithmetic on save.
 *
 * Null means there is nothing to show: a figure that is not a positive number, an
 * entry with no amount to scale, or calories typed onto something that cost none.
 */
export function editPreview(
  entry: Scalable,
  field: 'quantity' | 'kcal',
  value: number,
): Scalable | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  const from = entry[field];
  if (!Number.isFinite(from) || from <= 0) return null;

  const factor = value / from;

  return {
    // The box being typed in keeps exactly what was typed; only the other moves.
    // Amounts are kept finer than a tenth because a quarter of a serving is real.
    quantity: field === 'quantity' ? value : round3(entry.quantity * factor),
    grams: round1(entry.grams * factor),
    kcal: field === 'kcal' ? value : round1(entry.kcal * factor),
    protein_g: round1(entry.protein_g * factor),
    fat_g: round1(entry.fat_g * factor),
    carb_g: round1(entry.carb_g * factor),
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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
