/**
 * Which parts of the day this phone bothers to track.
 *
 * Turning one off only hides it. Nothing is deleted and nothing stops being
 * recorded server-side, so switching a feature back on brings its history with it —
 * these are a question about what is worth looking at, not about what is true.
 *
 * Stored on the device rather than on the user, which is the same call the
 * collapsible cards make: it is about this screen, and moving it to the server
 * later is a migration and a route, not a rewrite. Say so if it ever needs to
 * follow you between devices.
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

const KEY = 'health:settings';

/**
 * Anything unreadable reads as the defaults. A corrupt or half-written value should
 * cost you the preference, never the screen — and everything on is the state the app
 * shipped in, so falling back to it can only ever show too much, never too little.
 */
export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;

    const source = parsed as Record<string, unknown>;
    // Key by key, so a stored blob written by an older version — or a newer one
    // with a feature this build has never heard of — still yields a whole object.
    return {
      food: bool(source.food),
      exercise: bool(source.exercise),
      sleep: bool(source.sleep),
      weight: bool(source.weight),
      goals: bool(source.goals),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode and similar can throw. A preference that will not stick is
    // better than a screen that will not render.
  }
}

/** Only an explicit false turns a feature off; a missing key means "not chosen yet". */
function bool(value: unknown): boolean {
  return value !== false;
}
