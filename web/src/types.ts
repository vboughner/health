import type { Settings } from './settings';

/** What you are aiming at today. Past days are judged by what was in force then. */
export interface Goals {
  kcal_budget: number;
  burn_target: number;
  window_start: string;
  window_end: string;
  /** Grams a day. Both null is no target. */
  protein_min_g: number | null;
  protein_max_g: number | null;
  /** Days with a weights session per Mon–Sun week. Null is no target. */
  weights_per_week: number | null;
}

export interface User {
  id: number;
  username: string;
  timezone: string;
  /** Which features this account tracks. Same shape as the local Settings type. */
  features: Settings;
}

/** A food already stored — has an id, so it can be logged by reference. */
export interface Food {
  id: number;
  source: 'usda' | 'manual';
  source_id: string | null;
  name: string;
  brand: string | null;
  serving_desc: string | null;
  serving_grams: number | null;
  kcal_per_100g: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  added_sugar_g: number | null;
  sodium_mg: number | null;
  ingredients: string | null;
  processed_flags: string[];
  /**
   * The serving is defined by its calories rather than its weight — "one bowl is
   * 320 cal". `serving_grams` is a bookkeeping 100 so the per-100g maths still lands
   * on exactly that figure, but no grams are shown and it cannot be logged by weight.
   */
  weight_unknown: boolean;
}

/** A USDA search hit — not stored yet, so it has no id. */
export interface UsdaFood {
  source_id: string;
  name: string;
  brand: string | null;
  serving_desc: string | null;
  serving_grams: number | null;
  kcal_per_100g: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  added_sugar_g: number | null;
  sodium_mg: number | null;
  ingredients: string | null;
}

/** Either kind, for the parts of the UI that just render a name and calories. */
export type Pickable = Food | UsdaFood;

export function isSaved(food: Pickable): food is Food {
  return 'id' in food;
}

export type Unit = 'g' | 'oz' | 'serving';

export interface FoodLogEntry {
  id: number;
  food_id: number | null;
  food_name: string;
  eaten_at: number;
  local_day: string;
  quantity: number;
  unit: Unit;
  grams: number;
  /** Snapshotted from the food, so a past entry keeps hiding its bookkeeping grams. */
  weight_unknown: boolean;
  /** Calories were all that was recorded — the macro figures below are zeros, not facts. */
  macros_unknown: boolean;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  processed_flags: string[];
}

export interface ExerciseEntry {
  id: number;
  local_day: string;
  logged_at: number;
  activity: string;
  minutes: number;
  kcal: number;
}

export interface Activity {
  id: string;
  label: string;
  met: number;
}

export interface DayEntry {
  local_day: string;
  weight_lb: number | null;
  sleep_start: number | null;
  sleep_end: number | null;
  goals_reviewed: boolean;
  sleep_hours: number | null;
}

/** Everything the Today screen needs, from one request. */
export interface DaySummary {
  date: string;
  food: {
    entries: FoodLogEntry[];
    totals: { kcal: number; protein_g: number; fat_g: number; carb_g: number };
    macros: { protein: number; fat: number; carb: number };
    /** How much of `totals.kcal` the split above is not speaking for. */
    macro_unknown_kcal: number;
    budget: number;
    remaining: number;
  };
  exercise: {
    entries: ExerciseEntry[];
    total: number;
    target: number;
  };
  window: {
    first: string | null;
    last: string | null;
    spanMinutes: number | null;
    startedOnTime: boolean | null;
    endedOnTime: boolean | null;
    compliant: boolean | null;
    target_start: string;
    target_end: string;
  };
  day: DayEntry;
}

export interface SearchResults {
  saved: Food[];
  usda: UsdaFood[];
  usdaConfigured: boolean;
  usdaError: string | null;
}

/**
 * The goals read aloud. Metadata only — the audio itself is fetched as a URL by the
 * player rather than carried through here.
 */
export interface GoalRecording {
  mime: string;
  bytes: number;
  duration_ms: number;
  recorded_at: number;
}
