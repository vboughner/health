import crypto from 'crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from './db';

export const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — this is a phone app, don't log me out weekly

export interface User {
  id: number;
  username: string;
  timezone: string;
  daily_kcal_budget: number;
  daily_burn_target: number;
  window_start: string;
  window_end: string;
}

const USER_COLUMNS =
  'id, username, timezone, daily_kcal_budget, daily_burn_target, window_start, window_end';

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

export async function createUser(db: Db, username: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, passwordHash, Date.now());
  return getUserById(db, Number(info.lastInsertRowid))!;
}

export function getUserById(db: Db, id: number): User | undefined {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as User | undefined;
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
