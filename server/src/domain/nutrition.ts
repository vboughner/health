/**
 * Serving math and macro splits. Pure — no database, no clock, no network.
 *
 * Everything in the foods table is stored per 100 g, because that is how USDA
 * publishes it and it makes unit conversion a single multiply.
 */

/** The per-100g nutrition facts a food carries. */
export interface Per100g {
  kcal_per_100g: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
}

export interface Nutrition {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
}

export type Unit = 'g' | 'oz' | 'serving';

const GRAMS_PER_OZ = 28.3495;

/**
 * Convert a logged quantity to grams.
 *
 * `serving` needs the food's own serving size; a food with no serving size on
 * record can only be logged by weight.
 */
export function toGrams(quantity: number, unit: Unit, servingGrams?: number | null): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }

  switch (unit) {
    case 'g':
      return quantity;
    case 'oz':
      return quantity * GRAMS_PER_OZ;
    case 'serving':
      if (!servingGrams || servingGrams <= 0) {
        throw new Error('This food has no serving size on record — log it by weight instead');
      }
      return quantity * servingGrams;
  }
}

/** Scale per-100g facts to an actual amount in grams. */
export function nutritionForGrams(food: Per100g, grams: number): Nutrition {
  const factor = grams / 100;
  return {
    kcal: round1(food.kcal_per_100g * factor),
    protein_g: round1(food.protein_g * factor),
    fat_g: round1(food.fat_g * factor),
    carb_g: round1(food.carb_g * factor),
  };
}

/** Sum a day's worth of entries. */
export function sumNutrition(entries: Nutrition[]): Nutrition {
  const total = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein_g: acc.protein_g + e.protein_g,
      fat_g: acc.fat_g + e.fat_g,
      carb_g: acc.carb_g + e.carb_g,
    }),
    { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 },
  );

  return {
    kcal: round1(total.kcal),
    protein_g: round1(total.protein_g),
    fat_g: round1(total.fat_g),
    carb_g: round1(total.carb_g),
  };
}

export interface MacroSplit {
  protein: number;
  fat: number;
  carb: number;
}

const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 };

/**
 * Macro split as percentages of calories (not of grams — a gram of fat carries
 * more than twice the calories of a gram of carbohydrate, and the goal note
 * cares about the calorie split).
 *
 * Percentages are computed from the macros themselves rather than from the
 * food's calorie figure, so they always add to 100 even when the two disagree
 * slightly, as USDA rounding often makes them. Returns zeros for an empty day.
 */
export function macroSplit(n: Nutrition): MacroSplit {
  const proteinKcal = n.protein_g * KCAL_PER_G.protein;
  const fatKcal = n.fat_g * KCAL_PER_G.fat;
  const carbKcal = n.carb_g * KCAL_PER_G.carb;
  const total = proteinKcal + fatKcal + carbKcal;

  if (total <= 0) return { protein: 0, fat: 0, carb: 0 };

  return {
    protein: round1((proteinKcal / total) * 100),
    fat: round1((fatKcal / total) * 100),
    carb: round1((carbKcal / total) * 100),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
