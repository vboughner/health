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
 * Sleep as two wall-clock times. Bedtime is assumed to be the previous evening when
 * it is later than the wake time, which is the normal case and saves asking for a date.
 */
export function SleepInput({
  day,
  hours,
  onSave,
}: {
  day: DayEntry;
  hours: number | null;
  onSave: (start: number | null, end: number | null) => void;
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
    <div className="sleep-row">
      <label className="inline-field">
        <span className="inline-label">Asleep</span>
        <input type="time" value={bed} onChange={(e) => commit(e.target.value, wake)} />
      </label>
      <label className="inline-field">
        <span className="inline-label">Awake</span>
        <input type="time" value={wake} onChange={(e) => commit(bed, e.target.value)} />
      </label>
      <div className="sleep-total">
        {hours === null ? <span className="faint">—</span> : <strong>{hours}h</strong>}
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
        <label className="inline-input">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="minutes"
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
