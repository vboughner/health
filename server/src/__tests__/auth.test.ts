import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testDb, testApp, loginAs } from './helpers';
import type { Db } from '../db';
import {
  createSession,
  createUser,
  authenticate,
  getSessionUser,
  deleteSession,
  deleteExpiredSessions,
} from '../auth';

describe('auth', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = testDb();
    app = testApp(db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe('password handling', () => {
    it('accepts the right password and rejects the wrong one', async () => {
      await createUser(db, 'van', 'correct-horse');

      expect(await authenticate(db, 'van', 'correct-horse')).toMatchObject({ username: 'van' });
      expect(await authenticate(db, 'van', 'wrong-horse')).toBeUndefined();
    });

    it('never stores the password itself', async () => {
      await createUser(db, 'van', 'correct-horse');

      const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('van') as {
        password_hash: string;
      };

      expect(row.password_hash).not.toContain('correct-horse');
      expect(row.password_hash.startsWith('$argon2')).toBe(true);
    });

    it('treats usernames as case-insensitive', async () => {
      await createUser(db, 'van', 'correct-horse');
      expect(await authenticate(db, 'VAN', 'correct-horse')).toMatchObject({ username: 'van' });
    });

    it('returns undefined for an unknown user', async () => {
      expect(await authenticate(db, 'nobody', 'whatever')).toBeUndefined();
    });
  });

  describe('sessions', () => {
    it('resolves a live session to its user', async () => {
      const user = await createUser(db, 'van', 'correct-horse');
      const token = createSession(db, user.id);

      expect(getSessionUser(db, token)).toMatchObject({ id: user.id, username: 'van' });
    });

    it('rejects an unknown token', () => {
      expect(getSessionUser(db, 'not-a-real-token')).toBeUndefined();
    });

    it('rejects an expired session and cleans it up', async () => {
      const user = await createUser(db, 'van', 'correct-horse');
      const longAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const token = createSession(db, user.id, longAgo);

      expect(getSessionUser(db, token)).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 0 });
    });

    it('deleteSession revokes access immediately', async () => {
      const user = await createUser(db, 'van', 'correct-horse');
      const token = createSession(db, user.id);

      deleteSession(db, token);
      expect(getSessionUser(db, token)).toBeUndefined();
    });

    it('deleteExpiredSessions leaves live sessions alone', async () => {
      const user = await createUser(db, 'van', 'correct-horse');
      const live = createSession(db, user.id);
      createSession(db, user.id, Date.now() - 365 * 24 * 60 * 60 * 1000);

      expect(deleteExpiredSessions(db)).toBe(1);
      expect(getSessionUser(db, live)).toBeDefined();
    });

    it('cascades session deletion when a user is removed', async () => {
      const user = await createUser(db, 'van', 'correct-horse');
      createSession(db, user.id);

      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

      expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 0 });
    });
  });

  describe('routes', () => {
    it('logs in and sets an httpOnly session cookie', async () => {
      await createUser(db, 'van', 'correct-horse');

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'van', password: 'correct-horse' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({ username: 'van', daily_kcal_budget: 2400 });

      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toContain('sid=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('never returns the password hash to the client', async () => {
      await createUser(db, 'van', 'correct-horse');

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'van', password: 'correct-horse' },
      });

      expect(res.body).not.toContain('argon2');
      expect(res.json().user.password_hash).toBeUndefined();
    });

    it('rejects a bad password with 401', async () => {
      await createUser(db, 'van', 'correct-horse');

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'van', password: 'nope' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects a missing password with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'van' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('requires a session for /auth/me', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('returns the current user for /auth/me when logged in', async () => {
      const { cookie } = await loginAs(app, db, 'van');

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.username).toBe('van');
    });

    it('ignores a forged session cookie', async () => {
      await loginAs(app, db, 'van');

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: 'sid=deadbeef.forgedsignature' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('logout invalidates the session for good', async () => {
      const { cookie } = await loginAs(app, db, 'van');

      const out = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie },
      });
      expect(out.statusCode).toBe(200);

      const after = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });
      expect(after.statusCode).toBe(401);
    });
  });
});
