import { useState } from 'react';
import type { Activity, DayEntry, ExerciseEntry } from '../types';

/** Weight, entered in pounds. Saves on blur so there is no extra button to press. */
export function WeightInput({
  weight,
  onSave,
}: {
  weight: number | null;
  onSave: (lb: number) => void;
}) {
  const [value, setValue] = useState(weight === null ? '' : String(weight));

  function commit() {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0 && n !== weight) onSave(n);
  }

  return (
    <label className="inline-field">
      <span className="inline-label">Weight</span>
      <span className="inline-input">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="—"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
        />
        <span className="inline-unit">lb</span>
      </span>
    </label>
  );
}

/**
 * Sleep, as the night that ended on the morning of the day being shown.
 *
 * The two buttons stamp the current time so nothing has to be typed at 6am. Where
 * each stamp is filed, and the confirmation that says so, belong to the caller —
 * this stays a leaf input.
 */
export function SleepInput({
  day,
  hours,
  isToday,
  onSave,
  onStampWake,
  onStampBed,
}: {
  day: DayEntry;
  hours: number | null;
  isToday: boolean;
  onSave: (start: number | null, end: number | null) => void;
  onStampWake: () => void;
  onStampBed: () => void;
}) {
  const [bed, setBed] = useState(toTimeInput(day.sleep_start));
  const [wake, setWake] = useState(toTimeInput(day.sleep_end));

  function commit(nextBed: string, nextWake: string) {
    setBed(nextBed);
    setWake(nextWake);
    if (!nextBed || !nextWake) return;

    const wakeMs = onDay(day.local_day, nextWake);
    let bedMs = onDay(day.local_day, nextBed);
    // Went to bed "after" waking means the night before.
    if (bedMs >= wakeMs) bedMs -= 86_400_000;

    onSave(bedMs, wakeMs);
  }

  return (
    <div className="sleep">
      {/* Awake first — it is the one you press when the day starts. */}
      <div className="sleep-block">
        <span className="inline-label">Awake</span>
        <div className="sleep-controls">
          <input
            type="time"
            value={wake}
            aria-label="Awake time"
            onChange={(e) => commit(bed, e.target.value)}
          />
          {isToday && (
            <button className="btn sleep-btn" onClick={onStampWake}>
              Up
            </button>
          )}
        </div>
      </div>

      <div className="sleep-block">
        <span className="inline-label">Asleep</span>
        <div className="sleep-controls">
          <input
            type="time"
            value={bed}
            aria-label="Asleep time"
            onChange={(e) => commit(e.target.value, wake)}
          />
          {isToday && (
            <button className="btn sleep-btn" onClick={onStampBed}>
              Down
            </button>
          )}
        </div>
      </div>

      <div className="sleep-summary">
        {hours === null ? (
          <span className="faint">No sleep recorded</span>
        ) : (
          <>
            <strong>{hours} hours</strong>{' '}
            <span className="faint">in bed {isToday ? 'last night' : 'that night'}</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Log a workout: activity and duration. Calories come from the MET table scaled
 * by current body weight.
 *
 * The API still accepts an explicit calorie figure and tags it as measured, but
 * the form no longer asks — one number and one dropdown is the whole interaction.
 */
export function ExerciseInput({
  activities,
  onAdd,
}: {
  activities: Activity[];
  onAdd: (activity: string, minutes: number) => Promise<void>;
}) {
  const [activity, setActivity] = useState('running');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);

  const canAdd = Number(minutes) > 0 && !busy;

  async function add() {
    setBusy(true);
    try {
      await onAdd(activity, Number(minutes));
      setMinutes('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ex-form">
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
          />
          <span className="inline-unit">min</span>
        </label>
      </div>

      <button className="btn btn-block" onClick={add} disabled={!canAdd}>
        {busy ? <span className="spinner" /> : 'Add workout'}
      </button>
    </div>
  );
}

export function ExerciseList({
  entries,
  activities,
  onDelete,
}: {
  entries: ExerciseEntry[];
  activities: Activity[];
  onDelete: (id: number) => void;
}) {
  if (entries.length === 0) return null;

  const label = (id: string) => activities.find((a) => a.id === id)?.label ?? id;

  return (
    <div className="list">
      {entries.map((e) => (
        <div key={e.id} className="entry">
          <div className="entry-main">
            <div className="entry-name">{label(e.activity)}</div>
            <div className="entry-detail">{e.minutes} min</div>
          </div>
          <div className="entry-kcal">{Math.round(e.kcal)}</div>
          <button
            className="entry-del"
            onClick={() => onDelete(e.id)}
            aria-label={`Delete ${label(e.activity)}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function toTimeInput(epochMs: number | null): string {
  if (epochMs === null) return '';
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function onDay(localDay: string, hhmm: string): number {
  const [y, m, d] = localDay.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}
