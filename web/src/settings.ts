/**
 * Which parts of the day this account tracks.
 *
 * Turning one off only hides it. Nothing is deleted and nothing stops being
 * recorded server-side, so switching a feature back on brings its history with it —
 * these are a question about what is worth looking at, not about what is true.
 *
 * Stored on the account rather than on the device. It used to be the other way and
 * that was a deliberate choice; it is deliberately reversed, because one account
 * should mean one set of settings on every device you sign into. The values ride
 * along on the user from /auth/me; this module is now the list and the arithmetic.
 */
export interface Settings {
  /** The calorie header, the food list, macros, and the eating window. */
  food: boolean;
  exercise: boolean;
  /** Wake and bedtime, and the hours-in-bed line that pairs them. */
  sleep: boolean;
  /** The morning weigh-in. The weight chart on Trends is not affected. */
  weight: boolean;
  /**
   * Recording that the plan was read — the button on the day and the one that
   * writes it. The plan itself stays readable on the Goals tab either way; it is
   * the tracking that is optional, not the reading.
   */
  goals: boolean;
  /** The carb/protein/fat split. Drawn under Diet; off with it. */
  macros: boolean;
  /** The protein bar and chart against the range set under Goals. Under Macros. */
  protein: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
  macros: true,
  protein: true,
};

/**
 * Each toggle, in the order the Settings screen lists them. The labels are bare
 * nouns because the section heading above them already says Track — repeating the
 * verb on every line only makes them longer to read.
 */
export const FEATURES: {
  key: keyof Settings;
  label: string;
  detail: string;
  parent?: keyof Settings;
}[] = [
  // The stored key stays `food` — it is what every phone already has written down,
  // and renaming it would read as a fresh install with everything switched back on.
  {
    key: 'food',
    label: 'Diet',
    detail: 'Calories, what you ate, and the eating window.',
  },
  {
    key: 'macros',
    label: 'Macros',
    detail: 'The split of carbs, protein and fat.',
    parent: 'food',
  },
  {
    key: 'protein',
    label: 'Protein target',
    // Replaced on screen by the range itself, or by how to set one.
    detail: 'Grams a day against a range.',
    parent: 'macros',
  },
  { key: 'exercise', label: 'Exercise', detail: 'Workouts and calories burned.' },
  { key: 'sleep', label: 'Sleep', detail: 'Wake and bedtimes, and hours in bed.' },
  { key: 'weight', label: 'Weight', detail: 'The morning weigh-in.' },
  { key: 'goals', label: 'Goals', detail: 'Marking the plan as reviewed. It stays readable.' },
];

const PARENT = new Map(FEATURES.map((f) => [f.key, f.parent]));

/**
 * Whether a feature is being drawn: its own switch and every switch above it.
 *
 * Each is stored on its own, so turning Diet off and on again brings Macros and
 * Protein back as they were rather than resetting them. Every screen asks this
 * rather than reading a flag, so a nested toggle cannot be half-respected.
 */
export function isOn(settings: Settings, key: keyof Settings): boolean {
  for (let k: keyof Settings | undefined = key; k; k = PARENT.get(k)) {
    if (!settings[k]) return false;
  }
  return true;
}

/** How far a toggle is indented under its parents. */
export function depth(key: keyof Settings): number {
  let n = 0;
  for (let k = PARENT.get(key); k; k = PARENT.get(k)) n++;
  return n;
}

/**
 * True when every feature is off, so the day screen has nothing left to draw.
 *
 * Asked of FEATURES rather than of a written-out list, so a toggle added later is
 * counted here without anyone having to remember to come back. Sub-toggles do not
 * count — a child can draw nothing while its parent is off.
 */
export function nothingTracked(settings: Settings): boolean {
  return FEATURES.filter((f) => !f.parent).every((f) => !settings[f.key]);
}

const LEGACY_KEY = 'health:settings';

/**
 * Remove the per-device copy this app used to keep.
 *
 * The toggles that were on a phone before this change are not adopted — the server's
 * defaults win, and five checkboxes are seconds to re-set once. Deleting the key is
 * what stops a stale value from ever being read again.
 */
export function clearLegacySettings(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Private mode and similar can throw. A key that will not clear is not worth a
    // screen that will not render.
  }
}
