import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDuration, micUnavailableReason, saveRecording } from '../recording';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatDuration', () => {
  it('reads as a clock, not as a number of seconds', () => {
    expect(formatDuration(102_000)).toBe('1:42');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('rounds to the nearest second rather than truncating', () => {
    expect(formatDuration(1_600)).toBe('0:02');
  });

  it('never shows a negative or a broken clock', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});

describe('micUnavailableReason', () => {
  it('is null when the browser will hand over a microphone', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve() } });
    vi.stubGlobal('isSecureContext', true);
    expect(micUnavailableReason()).toBeNull();
  });

  it('blames the connection when the page is not secure', () => {
    // What an insecure origin actually looks like: mediaDevices is simply absent.
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('isSecureContext', false);
    expect(micUnavailableReason()).toMatch(/secure/i);
  });

  it('blames the browser when the page is secure but there is no API', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('isSecureContext', true);
    expect(micUnavailableReason()).toMatch(/browser/i);
  });
});

describe('saveRecording', () => {
  it('posts the bytes with the blob type and the measured duration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ recording: { mime: 'audio/webm' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const blob = new Blob(['bytes'], { type: 'audio/webm;codecs=opus' });
    await saveRecording({ blob, durationMs: 102_400 });

    const [url, init] = fetchMock.mock.calls[0];
    // Rounded, because the server wants an integer and the clock gives fractions.
    expect(url).toBe('/api/goals/recording?duration_ms=102400');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('audio/webm;codecs=opus');
    expect(init.body).toBe(blob);
  });

  it('turns a refusal into the message the server gave', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Cannot store audio/flac audio' }), {
          status: 415,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      saveRecording({ blob: new Blob(['x'], { type: 'audio/flac' }), durationMs: 1000 }),
    ).rejects.toThrow('Cannot store audio/flac audio');
  });
});
