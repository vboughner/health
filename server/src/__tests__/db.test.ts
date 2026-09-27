import { describe, it, expect } from 'vitest';
import { openDatabase, runMigrations } from '../db';
import { testDb } from './helpers';
import {
  getGoalRecording,
  putGoalRecording,
  deleteGoalRecording,
  type GoalRecording,
} from '../store';
import { createUser } from '../auth';

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
    expect(versions).toContain('009_protein_weights.sql');

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

describe('goal recordings', () => {
  function row(overrides: Partial<GoalRecording> = {}): GoalRecording {
    return {
      filename: 'goals-1-1755200000000.webm',
      mime: 'audio/webm',
      bytes: 240_000,
      duration_ms: 102_000,
      recorded_at: 1755200000000,
      ...overrides,
    };
  }

  it('stores and reads back a recording', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');

    expect(getGoalRecording(db, user.id)).toBeUndefined();

    putGoalRecording(db, user.id, row());
    expect(getGoalRecording(db, user.id)).toEqual(row());
  });

  it('replaces rather than accumulates, and hands back the row it replaced', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');

    putGoalRecording(db, user.id, row());
    const previous = putGoalRecording(
      db,
      user.id,
      row({ filename: 'goals-1-1755300000000.m4a', mime: 'audio/mp4', recorded_at: 1755300000000 }),
    );

    // The caller needs the old filename to delete the file it left behind.
    expect(previous?.filename).toBe('goals-1-1755200000000.webm');
    expect(getGoalRecording(db, user.id)?.mime).toBe('audio/mp4');
    expect(db.prepare('SELECT COUNT(*) AS n FROM goal_recordings').get()).toEqual({ n: 1 });
  });

  it('deleting returns the row so its file can go too', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');

    expect(deleteGoalRecording(db, user.id)).toBeUndefined();

    putGoalRecording(db, user.id, row());
    expect(deleteGoalRecording(db, user.id)?.filename).toBe('goals-1-1755200000000.webm');
    expect(getGoalRecording(db, user.id)).toBeUndefined();
  });

  it('keeps one user out of another user recording', async () => {
    const db = testDb();
    const van = await createUser(db, 'van', 'correct-horse');
    const other = await createUser(db, 'other', 'correct-horse');

    putGoalRecording(db, van.id, row());

    expect(getGoalRecording(db, other.id)).toBeUndefined();
    expect(deleteGoalRecording(db, other.id)).toBeUndefined();
    // And the other user's attempt did not disturb the real one.
    expect(getGoalRecording(db, van.id)).toEqual(row());
  });

  it('goes when the user does', async () => {
    const db = testDb();
    const user = await createUser(db, 'van', 'correct-horse');
    putGoalRecording(db, user.id, row());

    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    expect(getGoalRecording(db, user.id)).toBeUndefined();
  });
});
