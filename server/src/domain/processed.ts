/**
 * Flags refined and heavily processed foods.
 *
 * The point is a nudge, not a verdict. The goals note asks for "a gentle reminder
 * to avoid eating it again rather than a harsh block", plus a visible marker that
 * stays on the food so it's noticed before being picked again. A false positive
 * costs a moment's annoyance; a false negative costs nothing much either. So the
 * rules stay simple and legible rather than clever.
 *
 * Pure — no database, no network.
 */

/** Tunable in one place, since these want adjusting after real use. */
export const THRESHOLDS = {
  /** grams of added sugar per 100 g */
  addedSugarPer100g: 10,
  /** milligrams of sodium per 100 g */
  sodiumPer100g: 500,
};

export interface Classifiable {
  added_sugar_g?: number | null;
  sodium_mg?: number | null;
  ingredients?: string | null;
}

interface IngredientRule {
  reason: string;
  patterns: RegExp[];
}

const INGREDIENT_RULES: IngredientRule[] = [
  {
    reason: 'refined flour',
    patterns: [
      /\benriched\s+(?:wheat\s+)?flour\b/i,
      /\bwhite\s+flour\b/i,
      /\bbleached\s+flour\b/i,
      /\brefined\s+flour\b/i,
    ],
  },
  {
    reason: 'refined sugar',
    patterns: [
      /\bhigh[\s-]fructose\s+corn\s+syrup\b/i,
      /\bcorn\s+syrup\b/i,
      /\bdextrose\b/i,
      /\bmaltodextrin\b/i,
      /\binvert\s+sugar\b/i,
      /\bcane\s+syrup\b/i,
    ],
  },
  {
    reason: 'hydrogenated fat',
    patterns: [/\bhydrogenated\b/i, /\bshortening\b/i, /\binteresterified\b/i],
  },
  {
    reason: 'artificial ingredients',
    patterns: [
      /\bartificial\b/i,
      /\bsodium\s+nitr(?:ate|ite)\b/i,
      /\bmonosodium\s+glutamate\b/i,
      /\bsoy\s+protein\s+isolate\b/i,
      /\bpotassium\s+sorbate\b/i,
      /\b(?:red|blue|yellow)\s+(?:no\.?\s*)?\d+\b/i,
    ],
  },
];

/**
 * Return human-readable reasons this food looks refined or processed.
 * An empty array means nothing tripped — the normal case for whole foods.
 *
 * USDA Foundation and SR Legacy entries (raw fruit, vegetables, rice, beans —
 * most of this diet) carry no ingredient list at all, so they only ever trip on
 * the nutrient thresholds, which whole foods essentially never cross.
 */
export function classify(food: Classifiable): string[] {
  const reasons: string[] = [];

  if (
    typeof food.added_sugar_g === 'number' &&
    food.added_sugar_g >= THRESHOLDS.addedSugarPer100g
  ) {
    reasons.push('high added sugar');
  }

  if (typeof food.sodium_mg === 'number' && food.sodium_mg >= THRESHOLDS.sodiumPer100g) {
    reasons.push('high sodium');
  }

  const ingredients = food.ingredients ?? '';
  if (ingredients) {
    for (const rule of INGREDIENT_RULES) {
      if (rule.patterns.some((p) => p.test(ingredients))) {
        reasons.push(rule.reason);
      }
    }
  }

  return reasons;
}

/** One short sentence for the banner shown when a flagged food is logged. */
export function warningText(reasons: string[]): string {
  if (reasons.length === 0) return '';
  const list =
    reasons.length === 1
      ? reasons[0]
      : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`;
  return `Heads up — this one is flagged for ${list}. Worth skipping next time.`;
}
