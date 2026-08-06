import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Open the database, applying any migrations that haven't run yet.
 * Pass ':memory:' for tests.
 */
export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  // WAL lets a backup read the file while the app is writing to it.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

/**
 * Apply every .sql file in migrations/ that hasn't been applied yet, in filename order.
 * Each runs in its own transaction, so a failure leaves the database on the last good
 * version rather than half-migrated.
 */
export function runMigrations(db: Db): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: string }).version),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        file,
        Date.now(),
      );
    });
    apply();
    ran.push(file);
  }

  return ran;
}
