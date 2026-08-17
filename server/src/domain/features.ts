/**
 * Which parts of the day an account tracks.
 *
 * The list lives in one place so that validating a request body iterates it rather
 * than spelling the keys out again — the same property the web's FEATURES list has,
 * where nothingTracked() asks the list rather than a copy of it. A toggle added later
 * is validated, stored and counted without anyone remembering to come back.
 */
export const FEATURE_KEYS = ['food', 'exercise', 'sleep', 'weight', 'goals'] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

/** The column each key is stored in. */
export const FEATURE_COLUMNS: Record<FeatureKey, string> = {
  food: 'track_food',
  exercise: 'track_exercise',
  sleep: 'track_sleep',
  weight: 'track_weight',
  goals: 'track_goals',
};
