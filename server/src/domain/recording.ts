/**
 * What counts as audio we are willing to store, and what to call it on disk.
 *
 * Pure like the rest of domain/: the routes do the writing, this decides the names
 * and the limits.
 */

/**
 * The mime types we accept and the extension each gets.
 *
 * Whatever the browser's MediaRecorder produced is what gets stored — Chrome gives
 * audio/webm, Safari gives audio/mp4 — so this is the set of things a browser might
 * hand us rather than a preference between them. Nothing is transcoded.
 */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/**
 * 10 MB. A runaway guard rather than a real ceiling: ten minutes of opus is nearer
 * 2.5 MB, so a recording that runs to MAX_RECORDING_MS still fits comfortably.
 * The two limits were picked together — moving one means checking the other.
 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Ten minutes. The plan takes about two to read aloud. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

/**
 * A Content-Type without its parameters, lowercased.
 *
 * MediaRecorder sends `audio/webm;codecs=opus`; what we store and serve back is
 * `audio/webm`. Keeping the parameter would mean the allowlist had to enumerate
 * codec spellings it has no opinion about.
 */
export function normalizeMime(header: string): string {
  return header.split(';')[0].trim().toLowerCase();
}

/**
 * The extension for an accepted mime type, or null for anything else.
 *
 * Returning null rather than a default is what keeps the extension safe to
 * concatenate into a filename: it can only ever be one of the strings above.
 */
export function extensionFor(mime: string): string | null {
  const normalized = normalizeMime(mime);
  // hasOwnProperty rather than a bare lookup: `constructor` and friends are on every
  // object's prototype, and a truthy hit there would put a function where the
  // extension goes.
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, normalized)
    ? EXTENSIONS[normalized]
    : null;
}

/**
 * Names carry the timestamp so a new take never writes over the file the row still
 * points at. The new one lands beside the old, and the old is removed only once the
 * row has moved — which is what makes a failed upload harmless.
 */
export function recordingFilename(userId: number, recordedAt: number, ext: string): string {
  return `goals-${userId}-${recordedAt}.${ext}`;
}
