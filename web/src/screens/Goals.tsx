/**
 * The plan, read here and edited here.
 *
 * It used to be a hardcoded copy of "The Plan" from Personal/Mid-2026 Goals.md. It is
 * the account's own text now: a second account will want to write its own, and there
 * is no reason it should live in someone else's vault. Keeping any outside note in
 * step is a personal habit the app knows nothing about.
 */

import { useState, useEffect } from 'react';
import { api } from '../api';
import { shortDayLabel } from '../dates';
import { renderPlan } from '../markdown';
import { GoalsPlayer } from '../components/GoalsPlayer';
import { GoalsRecorder } from '../components/GoalsRecorder';
import { PlanEditor } from '../components/PlanEditor';
import type { GoalRecording } from '../types';

export function Goals({
  date,
  today,
  trackReview,
  onReviewed,
}: {
  date: string;
  today: string;
  /**
   * Whether reviews are being recorded at all. With goal tracking off the plan is
   * still here to read — it is the recording that goes, not the reading.
   */
  trackReview: boolean;
  /** Called once the review is on record, so the day screen picks up the tick. */
  onReviewed: () => void;
}) {
  const [error, setError] = useState('');
  const [recording, setRecording] = useState<GoalRecording | null>(null);
  const [recordingError, setRecordingError] = useState('');
  const [plan, setPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState('');
  const [editing, setEditing] = useState(false);

  /**
   * A third effect in the same family as the recording fetch below: its own trigger,
   * its own failure message, so a plan that fails to load never gets blamed on the
   * recording (or the other way around).
   */
  useEffect(() => {
    let cancelled = false;

    api
      .getPlan()
      .then(({ plan: loaded }) => {
        if (!cancelled) setPlan(loaded);
      })
      .catch(() => {
        if (!cancelled) setPlanError('Could not load your plan.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function savePlan(next: string) {
    const { plan: saved } = await api.putPlan(next);
    setPlan(saved);
    setEditing(false);
  }

  /**
   * Kept apart from the review write below: that one runs on every day change, this one
   * only on arrival, and a failure in either must not be reported as the other. Failing
   * here means no speaker button, so it says so rather than leaving a silent gap.
   */
  useEffect(() => {
    let cancelled = false;

    api
      .get<{ recording: GoalRecording | null }>('/goals/recording')
      .then(({ recording }) => {
        if (!cancelled) setRecording(recording);
      })
      .catch(() => {
        if (!cancelled) setRecordingError('Could not check for a saved recording.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Opening the page is the review. There is nothing to press: a button that only
   * confirms what you did by arriving is a step that can be forgotten, and what the
   * flag records is having read the plan, not having agreed to anything.
   *
   * Nothing here branches on whether the day was already reviewed, so there is
   * nothing to fetch — coming back a second time just rewrites the same true.
   */
  useEffect(() => {
    if (!trackReview) return;
    let cancelled = false;

    api
      .put(`/day/${date}`, { goals_reviewed: true })
      .then(() => {
        if (!cancelled) onReviewed();
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not record that');
      });

    return () => {
      cancelled = true;
    };
  }, [date, trackReview, onReviewed]);

  return (
    <div className="stack">
      <div className="title-row">
        <h1 className="screen-title">Goals</h1>
        {/* The key is load-bearing, not decoration. GoalsPlayer holds play state that
            must not survive the recording underneath it being replaced or deleted, and
            a changing key is how React resets it — the component itself deliberately
            does not reset state in an effect. Drop the key and a re-record leaves the
            button claiming to play a file that no longer exists. */}
        <GoalsPlayer recording={recording} key={recording?.recorded_at ?? 'none'} />
      </div>

      {planError && <div className="error">{planError}</div>}

      {editing && plan !== null && (
        <PlanEditor initial={plan} onSave={savePlan} onCancel={() => setEditing(false)} />
      )}

      {!editing && plan !== null && plan.trim() === '' && (
        <div className="card">
          <div className="card-title">No plan yet</div>
          <p className="empty-note">
            Write down what you are aiming at and it shows up here, to read at arm&rsquo;s length in
            the morning.
          </p>
          <div className="row row-end">
            <button className="btn" onClick={() => setEditing(true)}>
              Write my plan
            </button>
          </div>
        </div>
      )}

      {!editing && plan !== null && plan.trim() !== '' && (
        <>
          {renderPlan(plan).map((block, i) => {
            if (block.kind === 'heading') {
              return (
                <div className="card-title plan-heading" key={i}>
                  {block.text}
                </div>
              );
            }
            if (block.kind === 'bullets') {
              return (
                <div className="card" key={i}>
                  <ul className="plan-list">
                    {block.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              );
            }
            return (
              <div className="card" key={i}>
                <p className="plan-paragraph">{block.text}</p>
              </div>
            );
          })}

          <div className="row row-end">
            <button className="btn-ghost tiny" onClick={() => setEditing(true)}>
              Edit plan
            </button>
          </div>
        </>
      )}

      {error && <div className="error">{error}</div>}

      {/* Past tense: by the time this is on screen the write has already gone. It
          is worth saying, because the day being marked is the one the rest of the
          app is pointed at rather than the one you are living. */}
      {trackReview && date !== today && (
        <div className="note tiny">
          Marked <strong>{shortDayLabel(date, today)}</strong> as reviewed, not today.
        </div>
      )}

      {recordingError && <div className="error">{recordingError}</div>}

      <GoalsRecorder recording={recording} onChange={setRecording} />
    </div>
  );
}
