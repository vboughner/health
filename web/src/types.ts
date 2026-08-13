export interface User {
  id: number;
  username: string;
  timezone: string;
  daily_kcal_budget: number;
  daily_burn_target: number;
  window_start: string;
  window_end: string;
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
  source: 'estimated' | 'measured';
  note: string | null;
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
  no_meat: boolean;
  no_dairy: boolean;
  note: string | null;
  sleep_hours: number | null;
}

/** Everything the Today screen needs, from one request. */
export interface DaySummary {
  date: string;
  food: {
    entries: FoodLogEntry[];
    totals: { kcal: number; protein_g: number; fat_g: number; carb_g: number };
    macros: { protein: number; fat: number; carb: number };
    budget: number;
    remaining: number;
  };
  exercise: {
    entries: ExerciseEntry[];
    total: number;
    estimated: number;
    measured: number;
    measuredShare: number;
    target: number;
  };
  net: { net: number; tooLow: boolean };
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
