import { useState } from 'react';
import { api } from '../api';
import { burnPreview } from '../exercise';
import type { Activity, ExerciseEntry } from '../types';

/**
 * Correcting a workout already in the day: what it was, and how long for.
 *
 * The calories are shown but never typed. They are only ever an estimate from the
 * MET table scaled by body weight — there is no second source to know better — so a
 * box to type them in would be an override dressed up as a correction, and nothing
 * in the row would record that it had happened.
 *
 * What is shown comes from scaling this entry's own figure, exactly as the server
 * does on save. Re-estimating would price a workout from months ago at what you
 * weigh today, which is the same trap `EditEntry` avoids by scaling its snapshot
 * rather than re-reading the food.
 */
export function EditExercise({
  entry,
  activities,
  onClose,
  onSaved,
}: {
  entry: ExerciseEntry;
  activities: Activity[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [activity, setActivity] = useState(entry.activity);
  const [minutes, setMinutes] = useState(String(entry.minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const value = Number(minutes);
  const kcal = burnPreview(entry, activity, value, activities);
  const ready = kcal !== null;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/log/exercise/${entry.id}`, { activity, minutes: value });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api.del(`/log/exercise/${entry.id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that');
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        {/* Named for the sheet, not for the entry. EditEntry titles itself with the
            food, which cannot change while you are looking at it; the activity here
            can, and a heading echoing the picker below it is a duplicate until you
            touch that picker and a contradiction afterwards. */}
        <div className="sheet-head">
          <div className="sheet-title">Workout</div>
        </div>

        <div className="ex-fields">
          <span className="select-wrap">
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              aria-label="Activity"
            >
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </span>
          <label className="inline-input">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              aria-label="Minutes"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              autoFocus
            />
            <span className="inline-unit">min</span>
          </label>
        </div>

        <div className="preview">
          {kcal === null ? (
            <div className="empty tiny">Enter how long it was.</div>
          ) : (
            <div className="faint tiny">Estimated {kcal} cal burned</div>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        {/* Delete sits apart from the pair below it, as it does on the food sheet:
            a tap to get here is the right price for the one irreversible action. */}
        <button className="btn btn-danger" onClick={remove} disabled={busy}>
          Delete
        </button>

        <div className="sheet-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!ready || busy}>
            {busy ? <span className="spinner" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
