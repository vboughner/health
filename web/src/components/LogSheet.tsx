import { useState, useMemo } from 'react';
import { api } from '../api';
import { preview } from '../nutrition';
import { atTimeOn, nowTime, shortDayLabel } from '../dates';
import { isSaved, type Pickable, type Unit } from '../types';
import { MacroBar } from './MacroBar';

const UNITS: { id: Unit; label: string }[] = [
  { id: 'serving', label: 'serving' },
  { id: 'g', label: 'grams' },
  { id: 'oz', label: 'oz' },
];

/** Midday, for backfilling a day where the actual time isn't remembered. */
const DEFAULT_BACKFILL_TIME = '12:00';

/**
 * Bottom sheet for choosing how much of a food to log, with a live preview of what
 * it costs. The server recomputes on save — the preview is only there so the choice
 * is informed.
 */
export function LogSheet({
  food,
  flags = [],
  date,
  today,
  onClose,
  onLogged,
}: {
  food: Pickable;
  flags?: string[];
  /** The day being logged to. */
  date: string;
  today: string;
  onClose: () => void;
  onLogged: (warning: string | null) => void;
}) {
  const hasServing = !!food.serving_grams && food.serving_grams > 0;
  // A food whose serving was defined by its calories has no weight anyone measured,
  // so servings are the only honest unit for it and grams are never shown.
  const servingsOnly = isSaved(food) && food.weight_unknown;
  const isBackfill = date !== today;

  const [unit, setUnit] = useState<Unit>(hasServing ? 'serving' : 'g');
  const [quantity, setQuantity] = useState(hasServing ? '1' : '100');
  // The eating-window stat is derived from these timestamps, so the time matters
  // as much as the amount. Prefilled with now, or midday when backfilling.
  const [time, setTime] = useState(isBackfill ? DEFAULT_BACKFILL_TIME : nowTime());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amount = Number(quantity);
  const p = useMemo(() => preview(food, amount, unit), [food, amount, unit]);

  async function log() {
    if (!p) return;
    setBusy(true);
    setError('');
    try {
      const when = { eaten_at: atTimeOn(date, time || DEFAULT_BACKFILL_TIME) };
      const body = isSaved(food)
        ? { food_id: food.id, quantity: amount, unit, ...when }
        : { food: { source: 'usda' as const, ...food }, quantity: amount, unit, ...when };

      const res = await api.post<{ warning: string | null }>('/log/food', body);
      onLogged(res.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that');
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="sheet-head">
          <div className="sheet-title">{food.name}</div>
          {food.brand && <div className="faint tiny">{food.brand}</div>}
        </div>

        {flags.length > 0 && (
          <div className="warn-banner">
            <strong>⚠ Flagged for {flags.join(', ')}.</strong> Fine to log — just worth skipping
            next time.
          </div>
        )}

        <div className="qty-row">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-label="Quantity"
            autoFocus
          />
          {servingsOnly ? (
            <div className="qty-unit">{food.serving_desc || 'servings'}</div>
          ) : (
            <div className="seg">
              {UNITS.map((u) => (
                <button
                  key={u.id}
                  className="seg-btn"
                  aria-pressed={unit === u.id}
                  disabled={u.id === 'serving' && !hasServing}
                  onClick={() => setUnit(u.id)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {!hasServing && unit === 'serving' && (
          <div className="tiny faint">No serving size on record — log this one by weight.</div>
        )}

        <div className="when-row">
          <span className="inline-label">Eaten {shortDayLabel(date, today)} at</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Time eaten"
          />
        </div>

        {p ? (
          <div className="preview">
            <div className="preview-kcal">
              {Math.round(p.kcal)}
              <span className="preview-kcal-unit">cal</span>
              {!servingsOnly && <span className="faint tiny"> · {Math.round(p.grams)}g</span>}
            </div>
            <MacroBar protein_g={p.protein_g} fat_g={p.fat_g} carb_g={p.carb_g} />
          </div>
        ) : (
          <div className="empty tiny">Enter an amount.</div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="sheet-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={log} disabled={!p || busy}>
            {busy ? <span className="spinner" /> : 'Log It'}
          </button>
        </div>
      </div>
    </div>
  );
}
