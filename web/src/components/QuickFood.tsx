import { useState, FormEvent } from 'react';
import { api } from '../api';
import { atTimeOn, nowTime, shortDayLabel } from '../dates';

/** Midday, for backfilling a day where the actual time isn't remembered. */
const DEFAULT_BACKFILL_TIME = '12:00';

/**
 * A serving you already know: what it was and what it cost, straight into the day.
 *
 * Deliberately not a mode of ManualFood. That sheet saves a food you will pick
 * again and wants macros to do it with; this one saves nothing but the line in
 * today's log, and asks for the three things that line needs. There is no amount
 * step afterwards either — the calories entered are the calories eaten.
 */
export function QuickFood({
  date,
  today,
  onClose,
  onLogged,
}: {
  date: string;
  today: string;
  onClose: () => void;
  onLogged: (warning: string | null) => void;
}) {
  const isBackfill = date !== today;

  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  // The eating window is derived from these timestamps, so the time is not a
  // detail. Prefilled with now, or midday when backfilling, as the log sheet does.
  const [time, setTime] = useState(isBackfill ? DEFAULT_BACKFILL_TIME : nowTime());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/log/quick', {
        name: name.trim(),
        kcal: Number(kcal),
        eaten_at: atTimeOn(date, time || DEFAULT_BACKFILL_TIME),
      });
      // No warning to pass on: warnings come from a food's processed flags, and
      // this entry has no food behind it.
      onLogged(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that');
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-title">Calories only</div>
          <div className="faint tiny">No macros, and no food saved for later</div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="stack">
          <input
            placeholder="What was it?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />

          <label className="field">
            <span className="field-label">Calories</span>
            <input
              type="number"
              inputMode="numeric"
              step="any"
              min="0"
              placeholder="720"
              value={kcal}
              onChange={(e) => setKcal(e.target.value)}
              required
            />
          </label>

          <div className="when-row">
            <span className="inline-label">Eaten {shortDayLabel(date, today)} at</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Time eaten"
            />
          </div>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !name.trim() || !(Number(kcal) > 0)}
          >
            {busy ? <span className="spinner" /> : 'Log It'}
          </button>
        </div>
      </form>
    </div>
  );
}
