/**
 * Capturing the microphone and shipping the result.
 *
 * All the media plumbing lives here so the components hold UI state and nothing else.
 * Nothing in this file renders, and nothing that renders talks to MediaRecorder.
 */

import { api } from './api';
import type { GoalRecording } from './types';

/**
 * Ten minutes. Deliberately the same number as MAX_RECORDING_MS in the server's
 * domain/recording.ts — the two packages must not import each other, so it is written
 * twice on purpose. Change one and change the other.
 */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

export interface Take {
  blob: Blob;
  /**
   * Counted here, by the clock, rather than read back off the blob. Recordings out of
   * MediaRecorder routinely carry no duration in their header and an <audio> element
   * reports Infinity for them.
   */
  durationMs: number;
}

export interface Recorder {
  /** Ends the take and resolves with it. */
  stop(): Promise<Take>;
  /** Ends the take and throws it away, releasing the microphone either way. */
  cancel(): void;
}

/**
 * Why the microphone cannot be used, in words fit to put straight on the page, or null
 * when it can.
 *
 * The secure-context case is the one that will actually happen: over plain http on a
 * LAN address the browser does not merely refuse permission, it removes
 * navigator.mediaDevices altogether, so a page that only caught the permission error
 * would report nothing at all.
 */
export function micUnavailableReason(): string | null {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
    return null;

  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    return 'Recording needs a secure connection. Open the app over https, or on localhost, to record.';
  }
  return 'This browser will not give the page a microphone.';
}

/** Asks for the microphone and starts recording. Rejects if permission is refused. */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = Date.now();

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();

  // Tracks stay live until stopped by hand. Without this the browser goes on showing
  // the recording indicator after the take is over, which is alarming and fair.
  const release = () => stream.getTracks().forEach((track) => track.stop());

  return {
    stop: () =>
      new Promise<Take>((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            release();
            resolve({
              blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
              durationMs: Date.now() - startedAt,
            });
          },
          { once: true },
        );
        recorder.stop();
      }),

    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/** Uploads a take, replacing whatever was stored before. */
export function saveRecording(take: Take): Promise<{ recording: GoalRecording }> {
  const ms = Math.round(take.durationMs);
  return api.postBlob<{ recording: GoalRecording }>(
    `/goals/recording?duration_ms=${ms}`,
    take.blob,
  );
}

/** "1:42". Clock-shaped, because that is how long a thing feels. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';

  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
