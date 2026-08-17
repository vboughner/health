/**
 * Fill the database with a plausible six weeks of history, for looking at the
 * trend charts before there is any real data to look at.
 *
 *   npm run seed-demo --prefix server -- <username>
 *
 * Development only. It refuses to run against a production database.
 */
import { config } from '../config';
import { openDatabase } from '../db';
import { localDay } from '../domain/day';
import { estimateKcal, type ActivityId } from '../domain/exercise';
import {
  upsertFood,
  insertFoodLog,
  upsertDailyEntry,
  insertExercise,
  type NewFood,
} from '../store';
import { nutritionForGrams } from '../domain/nutrition';

const DAYS = 42;

/** Real USDA per-100g figures for the foods actually in this diet. */
const FOODS: (NewFood & { grams: number; hour: number })[] = [
  {
    source: 'usda',
    source_id: 'seed-oats',
    name: 'Oats, rolled, cooked',
    kcal_per_100g: 71,
    protein_g: 2.5,
    fat_g: 1.5,
    carb_g: 12,
    grams: 300,
    hour: 9,
  },
  {
    source: 'usda',
    source_id: 'seed-banana',
    name: 'Bananas, raw',
    kcal_per_100g: 89,
    protein_g: 1.09,
    fat_g: 0.33,
    carb_g: 22.8,
    grams: 118,
    hour: 9,
  },
  {
    source: 'usda',
    source_id: 'seed-berries',
    name: 'Blueberries, raw',
    kcal_per_100g: 57,
    protein_g: 0.74,
    fat_g: 0.33,
    carb_g: 14.5,
    grams: 140,
    hour: 11,
  },
  {
    source: 'usda',
    source_id: 'seed-beans',
    name: 'Beans, black, cooked',
    kcal_per_100g: 132,
    protein_g: 8.9,
    fat_g: 0.5,
    carb_g: 23.7,
    grams: 200,
    hour: 13,
  },
  {
    source: 'usda',
    source_id: 'seed-rice',
    name: 'Rice, brown, long-grain, cooked',
    kcal_per_100g: 123,
    protein_g: 2.74,
    fat_g: 0.97,
    carb_g: 25.6,
    grams: 220,
    hour: 13,
  },
  {
    source: 'usda',
    source_id: 'seed-spinach',
    name: 'Spinach, raw',
    kcal_per_100g: 23,
    protein_g: 2.9,
    fat_g: 0.4,
    carb_g: 3.6,
    grams: 120,
    hour: 13,
  },
  {
    source: 'usda',
    source_id: 'seed-apple',
    name: 'Apples, raw, with skin',
    kcal_per_100g: 52,
    protein_g: 0.26,
    fat_g: 0.17,
    carb_g: 13.8,
    grams: 180,
    hour: 16,
  },
  {
    source: 'usda',
    source_id: 'seed-tempeh',
    name: 'Tempeh',
    kcal_per_100g: 192,
    protein_g: 20.3,
    fat_g: 10.8,
    carb_g: 7.6,
    grams: 150,
    hour: 18,
  },
  {
    source: 'usda',
    source_id: 'seed-broccoli',
    name: 'Broccoli, cooked',
    kcal_per_100g: 35,
    protein_g: 2.4,
    fat_g: 0.4,
    carb_g: 7.2,
    grams: 200,
    hour: 18,
  },
  {
    source: 'usda',
    source_id: 'seed-almonds',
    name: 'Almonds, raw',
    kcal_per_100g: 579,
    protein_g: 21.2,
    fat_g: 49.9,
    carb_g: 21.6,
    grams: 28,
    hour: 15,
  },
];

/** The one indulgence that trips the processed-food flags. */
const TREAT: NewFood & { grams: number; hour: number } = {
  source: 'usda',
  source_id: 'seed-cookie',
  name: 'Cookies, chocolate chip, commercially prepared',
  kcal_per_100g: 474,
  protein_g: 5.1,
  fat_g: 24,
  carb_g: 63,
  added_sugar_g: 34,
  sodium_mg: 380,
  ingredients:
    'ENRICHED FLOUR, SUGAR, PARTIALLY HYDROGENATED SOYBEAN OIL, HIGH FRUCTOSE CORN SYRUP',
  grams: 60,
  hour: 20,
};

const WORKOUTS: Record<number, { activity: ActivityId; minutes: number }> = {
  1: { activity: 'running', minutes: 45 },
  2: { activity: 'climbing', minutes: 90 },
  3: { activity: 'running', minutes: 35 },
  4: { activity: 'weights', minutes: 50 },
  5: { activity: 'climbing', minutes: 90 },
  6: { activity: 'running', minutes: 60 },
};

/** Deterministic pseudo-random, so re-seeding gives the same picture. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function main() {
  const username = process.argv[2] ?? 'van';

  if (config.isProduction) {
    console.error('Refusing to seed demo data with NODE_ENV=production.');
    process.exit(1);
  }

  // Same reason as create-user: run without ENV_FILE and DB_PATH silently falls back
  // to <repo>/data/app.db. Note that the guard above only protects the real database
  // when the env file is loaded, since that is where NODE_ENV=production is set —
  // reaching production data here means having read this path and gone ahead.
  console.log(`Database: ${config.dbPath}`);

  const db = openDatabase(config.dbPath);
  const user = db.prepare('SELECT id, timezone FROM users WHERE username = ?').get(username) as
    { id: number; timezone: string } | undefined;

  if (!user) {
    console.error(`No user "${username}". Create one first: npm run create-user -- ${username}`);
    process.exit(1);
  }

  // The range is anchored to the day this runs, so seeded history goes stale as
  // soon as the date moves on. Clearing first makes re-running the normal way to
  // refresh it, instead of stacking a second copy on top of the overlapping days.
  const cleared = db.transaction(() => ({
    food: db.prepare('DELETE FROM food_log WHERE user_id = ?').run(user.id).changes,
    exercise: db.prepare('DELETE FROM exercise_log WHERE user_id = ?').run(user.id).changes,
    days: db.prepare('DELETE FROM daily_entries WHERE user_id = ?').run(user.id).changes,
  }))();

  if (cleared.food || cleared.exercise || cleared.days) {
    console.log(
      `Cleared ${cleared.food} food, ${cleared.exercise} exercise, ${cleared.days} day rows for "${username}".`,
    );
  }

  const foodIds = new Map(
    [...FOODS, TREAT].map((f) => [f.source_id!, upsertFood(db, user.id, f).id]),
  );

  // Seeded from the run date so a re-run on a new day reshuffles rather than
  // reproducing the identical six weeks shifted along by one.
  const random = rng(Number(localDay(Date.now(), user.timezone).replace(/-/g, '')));
  let weight = 196.4;

  const nowHour = new Date().getHours();

  for (let back = DAYS - 1; back >= 0; back--) {
    const isToday = back === 0;
    const dayMs = Date.now() - back * 86_400_000;
    const day = localDay(dayMs, user.timezone);
    const midnight = new Date(dayMs);
    midnight.setHours(0, 0, 0, 0);

    // Roughly half a pound a week, plus a pound of daily scale noise.
    weight -= 0.5 / 7;
    const reading = Math.round((weight + (random() - 0.5) * 2) * 10) / 10;

    // Two days in six get skipped entirely — real logs have gaps. Never today (an
    // empty Today screen is the thing this script exists to avoid) and never
    // yesterday, whose bedtime is what today's wake time pairs with to produce the
    // hours-in-bed figure.
    const isYesterday = back === 1;
    if (!isToday && !isYesterday && random() < 0.12) continue;

    const lateNight = random() < 0.18;
    const hasTreat = random() < 0.15;

    for (const food of [...FOODS, ...(hasTreat ? [TREAT] : [])]) {
      if (random() < 0.25) continue; // not everything every day

      const hour = food === TREAT && !lateNight ? 18 : food.hour;

      // Today is a day in progress — don't log dinner at ten in the morning.
      if (isToday && hour > nowHour) continue;

      const eatenAt = new Date(midnight).setHours(hour, Math.floor(random() * 55));
      const grams = Math.round(food.grams * (0.8 + random() * 0.4));

      insertFoodLog(db, user.id, {
        food_id: foodIds.get(food.source_id!)!,
        food_name: food.name,
        eaten_at: eatenAt,
        local_day: day,
        quantity: grams,
        unit: 'g',
        grams,
        // Seeded foods are all weighed — the calorie-per-serving kind is something
        // you type by hand, and there is nothing to demonstrate by faking one.
        weight_unknown: false,
        nutrition: nutritionForGrams(
          {
            kcal_per_100g: food.kcal_per_100g,
            protein_g: food.protein_g ?? 0,
            fat_g: food.fat_g ?? 0,
            carb_g: food.carb_g ?? 0,
          },
          grams,
        ),
      });
    }

    // Bed that evening, up the next morning — the two fields of one night live on
    // two different records, so each is stamped on the day it actually happened.
    // Bedtimes land between 21:30 and 23:30, wake times between 05:50 and 07:00,
    // which pairs out to roughly 6.5-9 hours a night.
    const sleepStart = new Date(midnight).setHours(21, 30 + Math.floor(random() * 120));
    const sleepEnd = new Date(midnight).setHours(5, 50 + Math.floor(random() * 70));

    upsertDailyEntry(db, user.id, day, {
      weight_lb: random() < 0.85 ? reading : null,
      // Tonight's bedtime has not happened yet if it is still early evening.
      sleep_start: isToday && nowHour < 21 ? null : sleepStart,
      // Today's wake time is deliberately left blank so it can be set by hand and
      // watched to update. Every earlier day gets one.
      sleep_end: isToday ? null : sleepEnd,
      goals_reviewed: random() < 0.8,
    });

    const WORKOUT_HOUR = 17;
    const workout = WORKOUTS[new Date(dayMs).getDay()];
    if (workout && random() < 0.85 && !(isToday && nowHour < WORKOUT_HOUR)) {
      insertExercise(db, user.id, {
        local_day: day,
        logged_at: new Date(midnight).setHours(WORKOUT_HOUR, 30),
        activity: workout.activity,
        minutes: workout.minutes,
        kcal: estimateKcal(workout.activity, workout.minutes, reading),
      });
    }
  }

  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM food_log WHERE user_id = ?) AS food,
              (SELECT COUNT(*) FROM exercise_log WHERE user_id = ?) AS exercise,
              (SELECT COUNT(*) FROM daily_entries WHERE user_id = ?) AS days`,
    )
    .get(user.id, user.id, user.id);

  db.close();
  console.log(`Seeded ${DAYS} days for "${username}":`, counts);
}

main();
