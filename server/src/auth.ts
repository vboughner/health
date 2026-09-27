import crypto from 'crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from './db';
import { localDay } from './domain/day';
import { FEATURE_COLUMNS, FEATURE_KEYS, type Features } from './domain/features';
import { DEFAULT_GOALS } from './domain/goals';
import { putGoalPeriod } from './store';

export const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — this is a phone app, don't log me out weekly

export interface User {
  id: number;
  username: string;
  timezone: string;
  features: Features;
}

const USER_COLUMNS = `id, username, timezone, ${FEATURE_KEYS.map((k) => FEATURE_COLUMNS[k]).join(', ')}`;

type UserRow = { id: number; username: string; timezone: string } & Record<string, number>;

/**
 * The feature flags ride along on the user row because getSessionUser calls this
 * on every authenticated request. A few integers on a row already being fetched are
 * free; the goals are a second table and the plan can run to kilobytes, so neither is
 * here. Routes that need those ask for them.
 */
function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    timezone: row.timezone,
    features: Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, !!row[FEATURE_COLUMNS[key]]]),
    ) as Features,
  };
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed hash should read as "wrong password", not crash the login route.
    return false;
  }
}

/**
 * Create an account and the goals it starts with, in one transaction.
 *
 * The period is seeded here rather than in scripts/create-user.ts because the test
 * helpers call this function too — so every account in every test has goals without
 * anyone having to arrange it.
 *
 * effective_from is the account's local today: localDay(now, timezone), read back
 * from the row that was just inserted because timezone has its own column default
 * and cannot be assumed here. Migration 005 seeds existing accounts' earliest period
 * from the UTC day instead, and that is fine there for a reason that does not carry
 * over — a .sql migration cannot resolve an IANA timezone, and being a day out costs
 * those accounts nothing because goalsForDay falls back to the earliest period for
 * anything behind it, and their creation days are long past. A new account has no
 * such cushion: it can be, and normally is, edited the same day it is created, so a
 * seed dated even one day ahead of local today (which the UTC day is, for roughly
 * seven evening hours a day in America/Los_Angeles) outranks that edit as the later
 * period and silently reverts it at midnight. Do not "simplify" this back to the UTC
 * day to match migration 005 — the two are only allowed to agree by coincidence.
 */
export async function createUser(db: Db, username: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  const now = Date.now();

  const create = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, now);

    const id = Number(info.lastInsertRowid);
    const { timezone } = db.prepare('SELECT timezone FROM users WHERE id = ?').get(id) as {
      timezone: string;
    };
    putGoalPeriod(db, id, {
      effective_from: localDay(now, timezone),
      ...DEFAULT_GOALS,
    });
    return id;
  });

  return getUserById(db, create())!;
}

export function getUserById(db: Db, id: number): User | undefined {
  const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as
    UserRow | undefined;

  return row ? toUser(row) : undefined;
}

export async function authenticate(
  db: Db,
  username: string,
  password: string,
): Promise<User | undefined> {
  const row = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username) as
    { id: number; password_hash: string } | undefined;

  if (!row) {
    // Hash anyway so a missing username and a wrong password take about the same time.
    await hashPassword(password);
    return undefined;
  }

  const ok = await verifyPassword(row.password_hash, password);
  return ok ? getUserById(db, row.id) : undefined;
}

export function createSession(db: Db, userId: number, now = Date.now()): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

export function getSessionUser(db: Db, token: string, now = Date.now()): User | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as
    { user_id: number; expires_at: number } | undefined;

  if (!row) return undefined;

  if (row.expires_at <= now) {
    deleteSession(db, token);
    return undefined;
  }

  return getUserById(db, row.user_id);
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function deleteExpiredSessions(db: Db, now = Date.now()): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
}

export const sessionCookieOptions = (isProduction: boolean) =>
  ({
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  }) as const;
