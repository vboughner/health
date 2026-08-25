import { useState } from 'react';
import { api } from '../api';
import { editPreview } from '../nutrition';
import { atTimeOn, timeOf, shortDayLabel } from '../dates';
import type { FoodLogEntry } from '../types';
import { MacroBar } from './MacroBar';

/**
 * Correcting a line already in the day: the amount, what it cost, or when.
 *
 * Deliberately not a mode of LogSheet, for the reason QuickFood is not a mode of
 * ManualFood. LogSheet prices a food from its per-100g figures and its whole
 * preview is built on having one; this sheet scales what an entry *recorded* and
 * may have no food behind it at all. Scaling the snapshot is what keeps an old
 * entry priced at what it cost on the day — re-reading the food would mean that
 * nudging a time could quietly re-price a meal eaten months ago.
 *
 * That is also why the unit is a label rather than a picker: the serving size
 * lives on the food, and the entry knows only the grams it worked out to.
 */
export function EditEntry({
  entry,
  date,
  today,
  onClose,
  onSaved,
}: {
  entry: FoodLogEntry;
  /** The day on screen. The time input is a wall-clock time on it. */
  date: string;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // No food behind it means no amount and no macros — a name, a number and a time.
  const isQuick = entry.food_id === null;

  const [name, setName] = useState(entry.food_name);
  const [time, setTime] = useState(timeOf(entry.eaten_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The amount and the calories are two spellings of one number, so only one is
  // ever state: whichever was typed last. The other is read off the preview, which
  // keeps them from drifting apart while you are still deciding.
  const [field, setField] = useState<'quantity' | 'kcal'>(isQuick ? 'kcal' : 'quantity');
  const [typed, setTyped] = useState(String(isQuick ? entry.kcal : entry.quantity));

  const value = Number(typed);
  const p = isQuick ? null : editPreview(entry, field, value);
  const shownFor = (of: 'quantity' | 'kcal') =>
    field === of ? typed : p ? String(readable(of, p[of])) : '';

  function retype(of: 'quantity' | 'kcal', next: string) {
    setField(of);
    setTyped(next);
  }

  const trimmed = name.trim();
  const ready = isQuick ? !!trimmed && Number.isFinite(value) && value > 0 : !!p;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const when = { eaten_at: atTimeOn(date, time || timeOf(entry.eaten_at)) };
      // Send whichever box was typed in, never both — the server sets the other
      // from it, and the one that was typed is the one that should be believed.
      const patch = isQuick ? { name: trimmed, kcal: value, ...when } : { [field]: value, ...when };

      await api.patch(`/log/food/${entry.id}`, patch);
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
      await api.del(`/log/food/${entry.id}`);
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

        <div className="sheet-head">
          {isQuick ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Name"
              placeholder="What was it?"
              autoFocus
            />
          ) : (
            <div className="sheet-title">{entry.food_name}</div>
          )}
        </div>

        {!isQuick && (
          <div className="qty-row">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={shownFor('quantity')}
              onChange={(e) => retype('quantity', e.target.value)}
              aria-label="Amount"
              autoFocus
            />
            <div className="qty-unit">{entry.unit === 'serving' ? 'servings' : entry.unit}</div>
          </div>
        )}

        <div className="qty-row">
          <input
            type="number"
            inputMode="numeric"
            step="any"
            min="0"
            value={shownFor('kcal')}
            onChange={(e) => retype('kcal', e.target.value)}
            aria-label="Calories"
            autoFocus={isQuick}
          />
          <div className="qty-unit">cal</div>
        </div>

        {/* A quick entry never had macros, and the amount it carries is the shape
            the table wanted rather than anything anyone measured — so there is
            nothing here to preview but the figure already in the box above. */}
        {!isQuick &&
          (p ? (
            <div className="preview">
              {/* Only worth saying when it is not already the box above: an entry
                  logged in grams would otherwise print its own amount back at it. */}
              {entry.unit !== 'g' && !entry.weight_unknown && (
                <div className="faint tiny">{Math.round(p.grams)}g</div>
              )}
              <MacroBar protein_g={p.protein_g} fat_g={p.fat_g} carb_g={p.carb_g} />
            </div>
          ) : (
            <div className="empty tiny">Enter an amount.</div>
          ))}

        <div className="when-row">
          <span className="inline-label">Eaten {shortDayLabel(date, today)} at</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Time eaten"
          />
        </div>

        {error && <div className="error">{error}</div>}

        {/* Delete sits apart from the pair below it. Reaching it costs a tap to
            open this sheet, which is the right price for the one action here
            that cannot be undone. */}
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

/**
 * How a figure reads in the box you are not typing in.
 *
 * Calories whole, because a tenth of one is noise and the row will round it away
 * anyway. Amounts by magnitude rather than by unit: 444 g wants no decimals, 2.5
 * servings wants one and a quarter serving wants two, and a figure that keeps
 * every digit it computed overflows a box sized for the ones people type.
 *
 * Cosmetic either way — what is sent is the figure that was typed, never the one
 * derived from it.
 */
function readable(of: 'quantity' | 'kcal', n: number): number {
  if (of === 'kcal') return Math.round(n);
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}
