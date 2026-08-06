import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from '../api';

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('prefixes paths with /api and sends cookies', async () => {
    const fetchMock = mockFetch(200, { user: { username: 'van' } });

    await api.me();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('sends a JSON body with the right content type', async () => {
    const fetchMock = mockFetch(200, { user: {} });

    await api.login('van', 'secret');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ username: 'van', password: 'secret' });
  });

  it('throws ApiError carrying the status so 401 can be handled specially', async () => {
    mockFetch(401, { error: 'Wrong username or password' });

    await expect(api.me()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Wrong username or password',
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    await expect(api.me()).rejects.toThrow('Request failed (502)');
  });

  it('is an instanceof ApiError so callers can narrow on it', async () => {
    mockFetch(401, { error: 'nope' });

    await api.me().catch((err) => {
      expect(err).toBeInstanceOf(ApiError);
    });
  });
});
