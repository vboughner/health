import { describe, it, expect } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  normalizeMime,
  extensionFor,
  recordingFilename,
} from '../domain/recording';

describe('normalizeMime', () => {
  it('drops the codecs parameter MediaRecorder sends', () => {
    expect(normalizeMime('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('lowercases and trims', () => {
    expect(normalizeMime('  Audio/WEBM ; codecs=opus')).toBe('audio/webm');
  });

  it('leaves a bare type alone', () => {
    expect(normalizeMime('audio/mp4')).toBe('audio/mp4');
  });

  it('gives an empty string back for an empty header', () => {
    expect(normalizeMime('')).toBe('');
  });
});

describe('extensionFor', () => {
  it('accepts what browsers actually record', () => {
    expect(extensionFor('audio/webm')).toBe('webm');
    expect(extensionFor('audio/ogg')).toBe('ogg');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/mpeg')).toBe('mp3');
    expect(extensionFor('audio/wav')).toBe('wav');
  });

  it('normalizes before matching, so a codecs parameter still resolves', () => {
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
  });

  it('refuses anything not on the list', () => {
    expect(extensionFor('audio/flac')).toBeNull();
    expect(extensionFor('application/json')).toBeNull();
    expect(extensionFor('')).toBeNull();
  });

  it('refuses a type that would smuggle a path into the extension', () => {
    expect(extensionFor('audio/../../etc/passwd')).toBeNull();
  });
});

describe('recordingFilename', () => {
  it('carries the user and the timestamp, so a re-record never lands on the old file', () => {
    expect(recordingFilename(7, 1755200000000, 'webm')).toBe('goals-7-1755200000000.webm');
  });
});

describe('the limits', () => {
  // These two are chosen together: ten minutes of opus is nearer 2.5 MB, so a
  // recording that hits the time cap still fits under the size cap and uploads
  // rather than being rejected at the door after you have already read it out.
  it('leaves room for a recording of the maximum length', () => {
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_RECORDING_MS).toBe(10 * 60 * 1000);
  });
});
