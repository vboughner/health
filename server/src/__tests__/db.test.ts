import { describe, it, expect } from 'vitest';
import { openDatabase, runMigrations } from '../db';

describe('migrations', () => {
  it('creates every table the app needs', () => {
    const db = openDatabase(':memory:');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'users',
        'sessions',
        'foods',
        'food_log',
        'exercise_log',
        'daily_entries',
      ]),
    );

    db.close();
  });

  it('is idempotent — running again applies nothing', () => {
    const db = openDatabase(':memory:');

    expect(runMigrations(db)).toEqual([]);

    db.close();
  });

  it('records what it applied', () => {
    const db = openDatabase(':memory:');

    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((r) => (r as { version: string }).version);

    expect(versions).toContain('001_init.sql');

    db.close();
  });

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');

    expect(() =>
      db
        .prepare(
          `INSERT INTO food_log (user_id, food_name, eaten_at, local_day, quantity, unit, grams, kcal, protein_g, fat_g, carb_g)
           VALUES (999, 'ghost', 0, '2026-01-01', 1, 'g', 1, 1, 0, 0, 0)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);

    db.close();
  });
});
