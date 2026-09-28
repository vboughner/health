/**
 * The goals, read back in your own voice.
 *
 * A single button on the title row: a speaker when idle, a stop square while playing.
 * Pressing it while it plays stops and rewinds — there is no pause, because the page
 * this sits on is for reading and a scrubber across the top of it would cost more room
 * than restarting a two-minute recording costs patience.
 *
 * The caller must pass `key={recording?.recorded_at ?? 'none'}` (or equivalent):
 * when a recording is replaced or deleted, `playing`/`error` describe bytes that no
 * longer exist, and that is a state reset on an identity change, which React does by
 * remounting via a changing `key` rather than by setState inside an effect.
 *
 * A press sits in `loading` between the tap and the audio actually starting — on a
 * phone, over the network, `play()` can take a second or more to have anything to play.
 * The button stays enabled while loading so a second press cancels it, the same as
 * stopping playback does.
 */

import { useEffect, useRef, useState } from 'react';
import type { GoalRecording } from '../types';

export function GoalsPlayer({ recording }: { recording: GoalRecording | null }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

  /**
   * A count of presses, bumped on every fresh press AND on every stop — cancelling a
   * load in progress or stopping audio that's already playing, both go through the
   * same branch below and both bump it. That's what lets the .then()/.catch() tell
   * "this is the attempt I'm still waiting on" from "this is a stale settle from one
   * the user already walked away from": cancelling a load calls pause() on an element
   * whose play() promise hasn't settled, which makes that promise reject — a rejection
   * that means the user changed their mind, not that anything went wrong.
   */
  const attemptRef = useRef(0);

  /**
   * The value `attemptRef` held right after the last stop, or -1 if nothing has been
   * stopped yet. `onError` below uses it the same way: `attemptRef.current` moving
   * past this means a newer attempt has started since, so whatever the element is
   * doing now belongs to that attempt rather than to the one that was walked away
   * from.
   */
  const cancelledAttemptRef = useRef(-1);

  /**
   * Playback stops when this component does — leaving the Goals tab unmounts it, and
   * audio that outlived the page it belongs to would have no way to be stopped.
   *
   * Resetting `playing` when the recording is replaced is deliberately NOT done here.
   * That is a state reset on an identity change, which React does through a changing
   * `key` at the call site; doing it with a setState inside an effect is the pattern
   * react-hooks/set-state-in-effect exists to catch. See Goals.tsx, which passes
   * `key={recording?.recorded_at ?? 'none'}` — that key is load-bearing.
   */
  useEffect(() => {
    const el = audioRef.current;
    return () => {
      el?.pause();
    };
  }, []);

  if (!recording) return null;

  // The cache-buster is belt and braces next to the server's no-store: without it a
  // re-record can still be answered from the in-memory cache of the element itself.
  const src = `/api/goals/recording/audio?v=${recording.recorded_at}`;

  function toggle() {
    const el = audioRef.current;
    if (!el) return;

    if (playing || loading) {
      attemptRef.current += 1;
      cancelledAttemptRef.current = attemptRef.current;
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
      setLoading(false);
      return;
    }

    setError('');
    setLoading(true);
    const attempt = ++attemptRef.current;
    el.play()
      .then(() => {
        if (attemptRef.current !== attempt) return; // cancelled before it started
        setLoading(false);
        setPlaying(true);
      })
      // No setPlaying(false) here: play() rejecting means setPlaying(true) above never
      // ran, so playing is already false. If the .then/.catch order ever changes, that
      // stops being true and this needs setPlaying(false) added.
      .catch(() => {
        if (attemptRef.current !== attempt) return; // the cancel above, not a real error
        setLoading(false);
        setError('Could not play that recording.');
      });
  }

  const label = loading ? 'Loading the goals' : playing ? 'Stop the recording' : 'Play the goals';

  return (
    <>
      <button
        className="btn-icon"
        onClick={toggle}
        aria-pressed={playing}
        aria-busy={loading}
        aria-label={label}
      >
        {loading ? (
          <span className="spinner spinner-icon" />
        ) : playing ? (
          <StopIcon />
        ) : (
          <SpeakerIcon />
        )}
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onEnded={() => setPlaying(false)}
        onError={() => {
          if (
            isStaleMediaError({
              loading,
              playing,
              attempt: attemptRef.current,
              cancelledAttempt: cancelledAttemptRef.current,
            })
          )
            return;
          setPlaying(false);
          setLoading(false);
          setError('Could not play that recording.');
        }}
      />

      {error && <div className="error">{error}</div>}
    </>
  );
}

/**
 * Whether an `error` event from the <audio> element is a stale echo of a load the user
 * already walked away from, rather than this attempt's own.
 *
 * pause() does not abort the element's underlying network fetch, so a load or a
 * playback that was cancelled can still error afterwards. It might seem like that
 * could also corrupt a *later* attempt — the delayed error landing while a second
 * press is loading or playing, and being mistaken for that second attempt's failure.
 * It can't, on this element: `src` is fixed for the life of the component (a different
 * recording remounts it via `key`, per the file header), and nothing here ever calls
 * `load()`, so play() is called at most once per underlying resource fetch — a second
 * press resumes the same fetch rather than starting a new one. There is only ever one
 * fetch in flight, so whenever a newer attempt is loading or playing, an error belongs
 * to it too; it is not stale, and must still surface (`loading`/`playing` below cover
 * that). The only ambiguous moment is when nothing is currently attempting playback:
 * an error landing there is stale only if it is this same, already-abandoned fetch,
 * which the two attempt counts tell apart — `cancelledAttempt` caught up to `attempt`
 * at the last stop, and nothing newer has been pressed since.
 */
export function isStaleMediaError(state: {
  loading: boolean;
  playing: boolean;
  attempt: number;
  cancelledAttempt: number;
}): boolean {
  return !state.loading && !state.playing && state.cancelledAttempt === state.attempt;
}

/* Hand-rolled inline SVG, like the charts: 24-unit box, currentColor throughout, so
   the button's own colour states carry the icon with them. */

function SpeakerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" />
      <path
        d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
    </svg>
  );
}
