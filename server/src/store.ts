/**
 * All SQL lives here. Routes handle HTTP, domain/ handles math, this handles storage.
 *
 * Every query that touches user data takes a userId and filters on it, even though
 * there is one account today. That is the isolation the design asks for, and it is
 * only free if it is there from the first query.
 */
import type { Db } from './db';
import { classify } from './domain/processed';
import type { Nutrition } from './domain/nutrition';

export interface Food {
  id: number;
  user_id: number | null;
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
   * The serving is defined by its calories, not its weight. `serving_grams` is 100
   * so the per-100g arithmetic still works out to exactly the calories that were
   * typed, but nobody measured it — see migration 003. Such a food shows no grams
   * anywhere and can only be logged by the serving.
   */
  weight_unknown: boolean;
}

/** A food as supplied by the client — from a USDA search result or typed by hand. */
export interface NewFood {
  source: 'usda' | 'manual';
  source_id?: string | null;
  name: string;
  brand?: string | null;
  serving_desc?: string | null;
  serving_grams?: number | null;
  kcal_per_100g: number;
  protein_g?: number;
  fat_g?: number;
  carb_g?: number;
  added_sugar_g?: number | null;
  sodium_mg?: number | null;
  ingredients?: string | null;
  weight_unknown?: boolean;
}

export interface FoodLogEntry extends Nutrition {
  id: number;
  food_id: number | null;
  food_name: string;
  eaten_at: number;
  local_day: string;
  quantity: number;
  unit: string;
  grams: number;
  /** Snapshotted from the food, so a past entry keeps hiding its bookkeeping grams. */
  weight_unknown: boolean;
  processed_flags: string[];
}

const FOOD_COLUMNS = `
  id, user_id, source, source_id, name, brand, serving_desc, serving_grams,
  kcal_per_100g, protein_g, fat_g, carb_g, added_sugar_g, sodium_mg,
  ingredients, processed_flags, weight_unknown
`;

interface FoodRow extends Omit<Food, 'processed_flags' | 'weight_unknown'> {
  processed_flags: string;
  weight_unknown: number;
}

function toFood(row: FoodRow | undefined): Food | undefined {
  if (!row) return undefined;
  return {
    ...row,
    processed_flags: parseFlags(row.processed_flags),
    // SQLite has no boolean; the column is 0 or 1.
    weight_unknown: row.weight_unknown === 1,
  };
}

function parseFlags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- foods

export function getFood(db: Db, id: number): Food | undefined {
  return toFood(db.prepare(`SELECT ${FOOD_COLUMNS} FROM foods WHERE id = ?`).get(id) as FoodRow);
}

/**
 * Store a food, or return the one already stored.
 *
 * USDA foods are shared (user_id NULL) and deduplicated on their fdcId, so two
 * accounts logging the same banana share one row and one classification. Manual
 * foods belong to the user who typed them and are matched on name, so logging
 * "Mom's soup" twice doesn't create a second entry.
 */
export function upsertFood(db: Db, userId: number, input: NewFood): Food {
  if (input.source === 'usda' && input.source_id) {
    const existing = toFood(
      db
        .prepare(`SELECT ${FOOD_COLUMNS} FROM foods WHERE source = 'usda' AND source_id = ?`)
        .get(input.source_id) as FoodRow,
    );
    if (existing) return existing;
  }

  if (input.source === 'manual') {
    const existing = toFood(
      db
        .prepare(
          `SELECT ${FOOD_COLUMNS} FROM foods WHERE source = 'manual' AND user_id = ? AND name = ? COLLATE NOCASE`,
        )
        .get(userId, input.name) as FoodRow,
    );
    if (existing) return existing;
  }

  const flags = classify({
    added_sugar_g: input.added_sugar_g,
    sodium_mg: input.sodium_mg,
    ingredients: input.ingredients,
  });

  const info = db
    .prepare(
      `INSERT INTO foods (
         user_id, source, source_id, name, brand, serving_desc, serving_grams,
         kcal_per_100g, protein_g, fat_g, carb_g, added_sugar_g, sodium_mg,
         ingredients, processed_flags, weight_unknown, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.source === 'manual' ? userId : null,
      input.source,
      input.source_id ?? null,
      input.name,
      input.brand ?? null,
      input.serving_desc ?? null,
      input.serving_grams ?? null,
      input.kcal_per_100g,
      input.protein_g ?? 0,
      input.fat_g ?? 0,
      input.carb_g ?? 0,
      input.added_sugar_g ?? null,
      input.sodium_mg ?? null,
      input.ingredients ?? null,
      JSON.stringify(flags),
      input.weight_unknown ? 1 : 0,
      Date.now(),
    );

  return getFood(db, Number(info.lastInsertRowid))!;
}

/**
 * Foods this user already knows: anything they've logged before, plus their own
 * manual entries. Deliberately not "every USDA food ever cached" — the point is a
 * short personal list, since the diet is a consistent rotation of the same foods.
 */
export function searchSavedFoods(db: Db, userId: number, query: string, limit = 10): Food[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT ${FOOD_COLUMNS.split(',')
        .map((c) => `f.${c.trim()}`)
        .join(', ')}
       FROM foods f
       WHERE f.name LIKE ? COLLATE NOCASE
         AND (f.user_id = ? OR f.id IN (SELECT food_id FROM food_log WHERE user_id = ?))
       ORDER BY f.name
       LIMIT ?`,
    )
    .all(`%${query}%`, userId, userId, limit) as FoodRow[];

  return rows.map((r) => toFood(r)!);
}

/** Foods most recently logged, newest first, one row per food. */
export function recentFoods(db: Db, userId: number, limit = 12): Food[] {
  const rows = db
    .prepare(
      `SELECT ${FOOD_COLUMNS.split(',')
        .map((c) => `f.${c.trim()}`)
        .join(', ')}, MAX(l.eaten_at) AS last_eaten
       FROM food_log l
       JOIN foods f ON f.id = l.food_id
       WHERE l.user_id = ?
       GROUP BY f.id
       ORDER BY last_eaten DESC
       LIMIT ?`,
    )
    .all(userId, limit) as FoodRow[];

  return rows.map((r) => toFood(r)!);
}

/** Foods logged most often — the quick-pick list that makes a repeat meal one tap. */
export function frequentFoods(db: Db, userId: number, limit = 12): Food[] {
  const rows = db
    .prepare(
      `SELECT ${FOOD_COLUMNS.split(',')
        .map((c) => `f.${c.trim()}`)
        .join(', ')}, COUNT(*) AS times
       FROM food_log l
       JOIN foods f ON f.id = l.food_id
       WHERE l.user_id = ?
       GROUP BY f.id
       ORDER BY times DESC, MAX(l.eaten_at) DESC
       LIMIT ?`,
    )
    .all(userId, limit) as FoodRow[];

  return rows.map((r) => toFood(r)!);
}

// ---------------------------------------------------------------- food log

export interface NewFoodLog {
  food_id: number;
  food_name: string;
  eaten_at: number;
  local_day: string;
  quantity: number;
  unit: string;
  grams: number;
  weight_unknown: boolean;
  nutrition: Nutrition;
}

export function insertFoodLog(db: Db, userId: number, entry: NewFoodLog): number {
  const info = db
    .prepare(
      `INSERT INTO food_log (
         user_id, food_id, food_name, eaten_at, local_day,
         quantity, unit, grams, weight_unknown, kcal, protein_g, fat_g, carb_g
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      entry.food_id,
      entry.food_name,
      entry.eaten_at,
      entry.local_day,
      entry.quantity,
      entry.unit,
      entry.grams,
      entry.weight_unknown ? 1 : 0,
      entry.nutrition.kcal,
      entry.nutrition.protein_g,
      entry.nutrition.fat_g,
      entry.nutrition.carb_g,
    );

  return Number(info.lastInsertRowid);
}

interface FoodLogRow extends Omit<FoodLogEntry, 'processed_flags' | 'weight_unknown'> {
  processed_flags: string;
  weight_unknown: number;
}

function toFoodLogEntry(row: FoodLogRow): FoodLogEntry {
  return {
    ...row,
    processed_flags: parseFlags(row.processed_flags),
    weight_unknown: row.weight_unknown === 1,
  };
}

export function listFoodLog(db: Db, userId: number, localDay: string): FoodLogEntry[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.food_id, l.food_name, l.eaten_at, l.local_day, l.quantity, l.unit,
              l.grams, l.weight_unknown, l.kcal, l.protein_g, l.fat_g, l.carb_g,
              COALESCE(f.processed_flags, '[]') AS processed_flags
       FROM food_log l
       LEFT JOIN foods f ON f.id = l.food_id
       WHERE l.user_id = ? AND l.local_day = ?
       ORDER BY l.eaten_at`,
    )
    .all(userId, localDay) as FoodLogRow[];

  return rows.map(toFoodLogEntry);
}

export function getFoodLogEntry(db: Db, userId: number, id: number): FoodLogEntry | undefined {
  const row = db
    .prepare(
      `SELECT l.id, l.food_id, l.food_name, l.eaten_at, l.local_day, l.quantity, l.unit,
              l.grams, l.weight_unknown, l.kcal, l.protein_g, l.fat_g, l.carb_g,
              COALESCE(f.processed_flags, '[]') AS processed_flags
       FROM food_log l
       LEFT JOIN foods f ON f.id = l.food_id
       WHERE l.user_id = ? AND l.id = ?`,
    )
    .get(userId, id) as FoodLogRow | undefined;

  if (!row) return undefined;
  return toFoodLogEntry(row);
}

/** Returns false when the entry doesn't exist or belongs to someone else. */
export function deleteFoodLog(db: Db, userId: number, id: number): boolean {
  return (
    db.prepare('DELETE FROM food_log WHERE user_id = ? AND id = ?').run(userId, id).changes > 0
  );
}

// ---------------------------------------------------------------- exercise log

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

export type NewExercise = Omit<ExerciseEntry, 'id'>;

export function insertExercise(db: Db, userId: number, entry: NewExercise): number {
  const info = db
    .prepare(
      `INSERT INTO exercise_log (user_id, local_day, logged_at, activity, minutes, kcal, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      entry.local_day,
      entry.logged_at,
      entry.activity,
      entry.minutes,
      entry.kcal,
      entry.source,
      entry.note,
    );

  return Number(info.lastInsertRowid);
}

export function listExercise(db: Db, userId: number, localDay: string): ExerciseEntry[] {
  return db
    .prepare(
      `SELECT id, local_day, logged_at, activity, minutes, kcal, source, note
       FROM exercise_log
       WHERE user_id = ? AND local_day = ?
       ORDER BY logged_at`,
    )
    .all(userId, localDay) as ExerciseEntry[];
}

export function deleteExercise(db: Db, userId: number, id: number): boolean {
  return (
    db.prepare('DELETE FROM exercise_log WHERE user_id = ? AND id = ?').run(userId, id).changes > 0
  );
}

// ---------------------------------------------------------------- daily entries

export interface DailyEntry {
  local_day: string;
  weight_lb: number | null;
  sleep_start: number | null;
  sleep_end: number | null;
  goals_reviewed: boolean;
  no_meat: boolean;
  no_dairy: boolean;
  note: string | null;
}

export type DailyEntryPatch = Partial<Omit<DailyEntry, 'local_day'>>;

const DAILY_FIELDS = [
  'weight_lb',
  'sleep_start',
  'sleep_end',
  'goals_reviewed',
  'no_meat',
  'no_dairy',
  'note',
] as const;

const BOOLEAN_FIELDS = new Set(['goals_reviewed', 'no_meat', 'no_dairy']);

interface DailyRow {
  local_day: string;
  weight_lb: number | null;
  sleep_start: number | null;
  sleep_end: number | null;
  goals_reviewed: number;
  no_meat: number;
  no_dairy: number;
  note: string | null;
}

/** An untouched day reads as all-blank rather than absent, so callers need no branch. */
export function getDailyEntry(db: Db, userId: number, localDay: string): DailyEntry {
  const row = db
    .prepare(
      `SELECT local_day, weight_lb, sleep_start, sleep_end, goals_reviewed,
              no_meat, no_dairy, note
       FROM daily_entries WHERE user_id = ? AND local_day = ?`,
    )
    .get(userId, localDay) as DailyRow | undefined;

  if (!row) {
    return {
      local_day: localDay,
      weight_lb: null,
      sleep_start: null,
      sleep_end: null,
      goals_reviewed: false,
      no_meat: false,
      no_dairy: false,
      note: null,
    };
  }

  return {
    ...row,
    goals_reviewed: !!row.goals_reviewed,
    no_meat: !!row.no_meat,
    no_dairy: !!row.no_dairy,
  };
}

/**
 * Update only the fields present in the patch, leaving the rest alone. Marking the
 * goals reviewed must not blank out the weight typed a moment earlier.
 */
export function upsertDailyEntry(
  db: Db,
  userId: number,
  localDay: string,
  patch: DailyEntryPatch,
): DailyEntry {
  const fields = DAILY_FIELDS.filter((f) => patch[f] !== undefined);

  db.prepare(
    'INSERT OR IGNORE INTO daily_entries (user_id, local_day, updated_at) VALUES (?, ?, ?)',
  ).run(userId, localDay, Date.now());

  if (fields.length > 0) {
    const assignments = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => {
      const value = patch[f];
      if (BOOLEAN_FIELDS.has(f)) return value ? 1 : 0;
      return value ?? null;
    });

    db.prepare(
      `UPDATE daily_entries SET ${assignments}, updated_at = ? WHERE user_id = ? AND local_day = ?`,
    ).run(...values, Date.now(), userId, localDay);
  }

  return getDailyEntry(db, userId, localDay);
}

/**
 * The most recent recorded weight on or before a day, used to scale the MET
 * estimate. Falls back to nothing rather than to a guess.
 */
export function latestWeight(db: Db, userId: number, onOrBefore: string): number | null {
  const row = db
    .prepare(
      `SELECT weight_lb FROM daily_entries
       WHERE user_id = ? AND local_day <= ? AND weight_lb IS NOT NULL
       ORDER BY local_day DESC LIMIT 1`,
    )
    .get(userId, onOrBefore) as { weight_lb: number } | undefined;

  return row?.weight_lb ?? null;
}

// ---------------------------------------------------------------- trends

export interface DayTotals {
  local_day: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  first_eaten_at: number | null;
  last_eaten_at: number | null;
  entry_count: number;
}

/** Per-day food totals over a range, for the trend charts. Days with nothing logged are absent. */
export function foodTotalsByDay(db: Db, userId: number, from: string, to: string): DayTotals[] {
  return db
    .prepare(
      `SELECT local_day,
              SUM(kcal) AS kcal, SUM(protein_g) AS protein_g,
              SUM(fat_g) AS fat_g, SUM(carb_g) AS carb_g,
              MIN(eaten_at) AS first_eaten_at, MAX(eaten_at) AS last_eaten_at,
              COUNT(*) AS entry_count
       FROM food_log
       WHERE user_id = ? AND local_day BETWEEN ? AND ?
       GROUP BY local_day
       ORDER BY local_day`,
    )
    .all(userId, from, to) as DayTotals[];
}

export function burnByDay(
  db: Db,
  userId: number,
  from: string,
  to: string,
): { local_day: string; kcal: number; minutes: number }[] {
  return db
    .prepare(
      `SELECT local_day, SUM(kcal) AS kcal, SUM(minutes) AS minutes
       FROM exercise_log
       WHERE user_id = ? AND local_day BETWEEN ? AND ?
       GROUP BY local_day
       ORDER BY local_day`,
    )
    .all(userId, from, to) as { local_day: string; kcal: number; minutes: number }[];
}

export function dailyEntriesInRange(
  db: Db,
  userId: number,
  from: string,
  to: string,
): DailyEntry[] {
  const rows = db
    .prepare(
      `SELECT local_day, weight_lb, sleep_start, sleep_end, goals_reviewed,
              no_meat, no_dairy, note
       FROM daily_entries
       WHERE user_id = ? AND local_day BETWEEN ? AND ?
       ORDER BY local_day`,
    )
    .all(userId, from, to) as DailyRow[];

  return rows.map((row) => ({
    ...row,
    goals_reviewed: !!row.goals_reviewed,
    no_meat: !!row.no_meat,
    no_dairy: !!row.no_dairy,
  }));
}

export interface GoalRecording {
  filename: string;
  mime: string;
  bytes: number;
  duration_ms: number;
  recorded_at: number;
}

export function getGoalRecording(db: Db, userId: number): GoalRecording | undefined {
  return db
    .prepare(
      `SELECT filename, mime, bytes, duration_ms, recorded_at
         FROM goal_recordings
        WHERE user_id = ?`,
    )
    .get(userId) as GoalRecording | undefined;
}

/**
 * Writes the row and returns whatever it replaced.
 *
 * The return value is the point: the caller is holding a file it has just written and
 * needs to know which older file is now unreferenced. Reading it here, inside the same
 * call that overwrites it, is the only moment both are knowable.
 */
export function putGoalRecording(
  db: Db,
  userId: number,
  rec: GoalRecording,
): GoalRecording | undefined {
  const previous = getGoalRecording(db, userId);

  db.prepare(
    `INSERT INTO goal_recordings (user_id, filename, mime, bytes, duration_ms, recorded_at)
     VALUES (@user_id, @filename, @mime, @bytes, @duration_ms, @recorded_at)
     ON CONFLICT(user_id) DO UPDATE SET
       filename    = excluded.filename,
       mime        = excluded.mime,
       bytes       = excluded.bytes,
       duration_ms = excluded.duration_ms,
       recorded_at = excluded.recorded_at`,
  ).run({ user_id: userId, ...rec });

  return previous;
}

/** Returns the row that was removed, so its file can be removed too. */
export function deleteGoalRecording(db: Db, userId: number): GoalRecording | undefined {
  const previous = getGoalRecording(db, userId);
  if (previous) db.prepare('DELETE FROM goal_recordings WHERE user_id = ?').run(userId);
  return previous;
}
