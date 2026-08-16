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
 */

import { useEffect, useRef, useState } from 'react';
import type { GoalRecording } from '../types';

export function GoalsPlayer({ recording }: { recording: GoalRecording | null }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

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

    if (playing) {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
      return;
    }

    setError('');
    el.play()
      .then(() => setPlaying(true))
      // No setPlaying(false) here: play() rejecting means setPlaying(true) above never
      // ran, so playing is already false. If the .then/.catch order ever changes, that
      // stops being true and this needs setPlaying(false) added.
      .catch(() => setError('Could not play that recording.'));
  }

  return (
    <>
      <button
        className="btn-icon"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? 'Stop the recording' : 'Play the goals'}
      >
        {playing ? <StopIcon /> : <SpeakerIcon />}
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setError('Could not play that recording.');
        }}
      />

      {error && <div className="error">{error}</div>}
    </>
  );
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
