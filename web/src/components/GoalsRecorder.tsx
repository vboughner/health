/**
 * Recording the goals, at the foot of the page you read them from.
 *
 * It lives down here rather than in a sheet or on another screen because the reading
 * and the recording are the same act: the plan stays on the page, scrollable, while
 * the take runs.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import {
  startRecording,
  saveRecording,
  micUnavailableReason,
  formatDuration,
  MAX_RECORDING_MS,
  type Recorder,
  type Take,
} from '../recording';
import type { GoalRecording } from '../types';

type Stage =
  | { name: 'idle' }
  | { name: 'starting' }
  | { name: 'recording'; recorder: Recorder }
  | { name: 'review'; take: Take }
  | { name: 'saving' };

export function GoalsRecorder({
  recording,
  onChange,
}: {
  recording: GoalRecording | null;
  onChange: (next: GoalRecording | null) => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const previewRef = useRef<HTMLAudioElement>(null);
  const takeBlob = stage.name === 'review' ? stage.take.blob : null;

  useObjectUrl(previewRef, takeBlob);

  /**
   * The running timer, and the cap that ends a take on its own.
   *
   * Stopping at the cap rather than letting it run means a recorder left going by
   * accident cannot grow past what the server will accept — the take you actually made
   * is saved, rather than refused after the fact.
   */
  useEffect(() => {
    if (stage.name !== 'recording') return;

    const startedAt = Date.now();

    const tick = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) void finish(stage.recorder);
    }, 200);

    return () => clearInterval(tick);
  }, [stage]);

  /**
   * An unmount mid-take must not leave the microphone open.
   *
   * This cleanup also fires on the ordinary move from recording to review, with the
   * old stage closed over, so cancel() gets called on a recorder that has already
   * stopped. That is deliberately harmless — cancel checks the state before stopping,
   * and stopping an ended track is a no-op — and it is what makes the unmount case
   * need no separate bookkeeping. Do not "fix" it by dropping stage from the deps.
   */
  useEffect(() => {
    return () => {
      if (stage.name === 'recording') stage.recorder.cancel();
    };
  }, [stage]);

  async function begin() {
    setError('');
    setConfirmingDelete(false);

    const unavailable = micUnavailableReason();
    if (unavailable) {
      setError(unavailable);
      return;
    }

    setStage({ name: 'starting' });
    try {
      const recorder = await startRecording();
      // Zeroed here rather than in the timer effect: the clock belongs to this take,
      // and a take begins on the tap, not on a render.
      setElapsed(0);
      setStage({ name: 'recording', recorder });
    } catch {
      // Overwhelmingly this is the permission prompt being dismissed.
      setStage({ name: 'idle' });
      setError('The microphone was not allowed. Check the site permissions and try again.');
    }
  }

  async function finish(recorder: Recorder) {
    const take = await recorder.stop();
    setStage({ name: 'review', take });
  }

  async function save(take: Take) {
    setStage({ name: 'saving' });
    setError('');
    try {
      const { recording: saved } = await saveRecording(take);
      onChange(saved);
      setStage({ name: 'idle' });
    } catch (err) {
      // Back to review, not to idle: the take is still in hand and still savable.
      setStage({ name: 'review', take });
      setError(err instanceof Error ? err.message : 'Could not save that recording');
    }
  }

  async function remove() {
    setError('');
    try {
      await api.del('/goals/recording');
      onChange(null);
      setConfirmingDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that recording');
    }
  }

  return (
    <div className="recorder">
      {stage.name === 'recording' && (
        <>
          <div className="recorder-status">
            <span className="recorder-dot" aria-hidden="true" />
            Recording <span className="recorder-time">{formatDuration(elapsed)}</span>
          </div>
          <button className="btn btn-block" onClick={() => void finish(stage.recorder)}>
            Stop
          </button>
        </>
      )}

      {stage.name === 'review' && (
        <>
          <div className="recorder-status">
            Listen back — {formatDuration(stage.take.durationMs)}
          </div>
          <audio className="recorder-preview" ref={previewRef} controls />

          <div className="recorder-actions">
            <button className="btn" onClick={() => setStage({ name: 'idle' })}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={() => void save(stage.take)}>
              Save
            </button>
          </div>
        </>
      )}

      {stage.name === 'saving' && (
        <button className="btn btn-block" disabled>
          Saving…
        </button>
      )}

      {(stage.name === 'idle' || stage.name === 'starting') && (
        <>
          <button
            className="btn btn-block"
            onClick={() => void begin()}
            disabled={stage.name === 'starting'}
          >
            {recording ? 'Re-record the goals' : 'Record the goals'}
          </button>

          {recording && (
            <div className="recorder-existing">
              <span className="muted tiny">
                Recorded {recordedOn(recording.recorded_at)} ·{' '}
                {formatDuration(recording.duration_ms)}
              </span>

              {confirmingDelete ? (
                <span className="recorder-confirm">
                  <button className="btn-ghost tiny" onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </button>
                  <button className="btn-ghost tiny danger" onClick={() => void remove()}>
                    Delete
                  </button>
                </span>
              ) : (
                <button className="btn-ghost tiny" onClick={() => setConfirmingDelete(true)}>
                  Delete recording
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** "12 Aug". The year is left off: a recording of the plan is not an anniversary. */
function recordedOn(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Puts a blob on an <audio> element, and revokes its url when the blob changes or the
 * element goes.
 *
 * Without the revoke every discarded take stays in memory for the life of the page,
 * which for a ten-minute recording is not a rounding error.
 *
 * The url goes straight onto the element rather than through state. It is a handle to
 * something outside React, made and released inside one effect, and writing it here
 * keeps the pair together: nothing can render a url the cleanup has already revoked.
 * Making it in the effect rather than at the moment the take is cut also survives the
 * remount Strict Mode does on every mount — a url created outside would be revoked by
 * that first cleanup and never made again, leaving a dead player in dev only.
 */
function useObjectUrl(ref: RefObject<HTMLAudioElement | null>, blob: Blob | null) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !blob) return;

    const url = URL.createObjectURL(blob);
    el.src = url;

    return () => {
      // Cleared before revoking so the element is not left holding a dead url in the
      // case where it outlives the take.
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [ref, blob]);
}
