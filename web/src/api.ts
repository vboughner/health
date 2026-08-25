import type { Goals, User } from './types';
import type { Settings } from './settings';

/** Thrown for any non-2xx response. `status` lets callers treat 401 as "log in again". */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Everything the two request shapes do once the response is back: raise on a failure,
 * and hand a 204 back as nothing. Pulled out because the raw-body upload needs exactly
 * this and has nothing else in common with `request`.
 */
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = await res.json();
      if (json?.error) message = json.error;
    } catch {
      // Non-JSON error body (nginx 502, for instance) — keep the generic message.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return unwrap<T>(res);
}

/**
 * Posts raw bytes rather than JSON: the body *is* the file.
 *
 * The blob's own type becomes the Content-Type, which is how the server learns whether
 * it was handed webm or mp4 without the page having to guess on the browser's behalf.
 */
async function postBlob<T>(path: string, blob: Blob): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });

  return unwrap<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  postBlob,

  login: (username: string, password: string) =>
    request<{ user: User; goals: Goals }>('POST', '/auth/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  me: () => request<{ user: User; goals: Goals }>('GET', '/auth/me'),

  putFeatures: (features: Settings) =>
    request<{ features: Settings }>('PUT', '/settings/features', features),
  putGoals: (goals: Goals, scope: 'from_today' | 'correction') =>
    request<{ goals: Goals }>('PUT', '/settings/goals', { ...goals, scope }),
  getPlan: () => request<{ plan: string }>('GET', '/settings/plan'),
  putPlan: (plan: string) => request<{ plan: string }>('PUT', '/settings/plan', { plan }),
};
