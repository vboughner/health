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
}

export const DEFAULT_SETTINGS: Settings = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
};

/**
 * Each toggle, in the order the Settings screen lists them. The labels are bare
 * nouns because the section heading above them already says Track — repeating the
 * verb on every line only makes them longer to read.
 */
export const FEATURES: { key: keyof Settings; label: string; detail: string }[] = [
  // The stored key stays `food` — it is what every phone already has written down,
  // and renaming it would read as a fresh install with everything switched back on.
  {
    key: 'food',
    label: 'Diet',
    detail: 'Calories, what you ate, macros, and the eating window.',
  },
  { key: 'exercise', label: 'Exercise', detail: 'Workouts and calories burned.' },
  { key: 'sleep', label: 'Sleep', detail: 'Wake and bedtimes, and hours in bed.' },
  { key: 'weight', label: 'Weight', detail: 'The morning weigh-in.' },
  { key: 'goals', label: 'Goals', detail: 'Marking the plan as reviewed. It stays readable.' },
];

/**
 * True when every feature is off, so the day screen has nothing left to draw.
 *
 * Asked of FEATURES rather than of a written-out list, so a toggle added later is
 * counted here without anyone having to remember to come back.
 */
export function nothingTracked(settings: Settings): boolean {
  return FEATURES.every((f) => !settings[f.key]);
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
