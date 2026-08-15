import { useState, FormEvent } from 'react';
import { api } from '../api';
import type { Food } from '../types';
import { LogSheet } from './LogSheet';

/** How the food's figures were come by, which decides what it can be logged in. */
type Basis = 'weight' | 'serving';

const BASES: { id: Basis; label: string }[] = [
  { id: 'weight', label: 'per 100 g' },
  { id: 'serving', label: 'per serving' },
];

/**
 * Escape hatch for anything USDA doesn't have — home cooking, a friend's recipe,
 * a label read off a package. Saved as a normal food, so it turns up in search and
 * quick picks afterwards.
 */
export function ManualFood({
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
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carb, setCarb] = useState('');
  const [servingGrams, setServingGrams] = useState('');
  const [servingDesc, setServingDesc] = useState('');
  const [basis, setBasis] = useState<Basis>('weight');
  const [created, setCreated] = useState<Food | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const byServing = basis === 'serving';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Everything is stored per 100 g, because that is how USDA publishes it. A
      // serving defined by its calories is the same shape with the serving pinned
      // at a nominal 100 g: the figures typed per serving are then already the
      // per-100g figures, one serving comes to exactly the calories entered, and
      // weight_unknown records that those grams were never measured.
      const res = await api.post<{ food: Food }>('/foods', {
        name: name.trim(),
        kcal_per_100g: Number(kcal),
        protein_g: num(protein),
        fat_g: num(fat),
        carb_g: num(carb),
        serving_grams: byServing ? 100 : servingGrams ? Number(servingGrams) : null,
        serving_desc: servingDesc.trim() || null,
        weight_unknown: byServing,
      });
      // Straight into the amount picker — creating a food is only ever a step
      // towards logging it.
      setCreated(res.food);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <LogSheet food={created} date={date} today={today} onClose={onClose} onLogged={onLogged} />
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-title">New food</div>
          <div className="faint tiny">
            {byServing ? 'Nutrition per serving' : 'Nutrition per 100 g'}
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="stack">
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />

          {/* Two ways to know a food. A label gives you grams; a bowl at the diner
              gives you a guess at what one bowl costs and nothing else. Asking for
              a weight there only invites a number nobody measured. */}
          <div className="seg">
            {BASES.map((b) => (
              <button
                key={b.id}
                type="button"
                className="seg-btn"
                aria-pressed={basis === b.id}
                onClick={() => setBasis(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="field-grid">
            <Field
              label={byServing ? 'Calories a serving' : 'Calories'}
              value={kcal}
              onChange={setKcal}
              required
            />
            <Field label="Protein g" value={protein} onChange={setProtein} />
            <Field label="Fat g" value={fat} onChange={setFat} />
            <Field label="Carbs g" value={carb} onChange={setCarb} />
          </div>

          <div className="field-grid">
            {!byServing && (
              <Field label="Serving grams" value={servingGrams} onChange={setServingGrams} />
            )}
            <label className="field">
              <span className="field-label">Serving name</span>
              <input
                placeholder="1 bowl"
                value={servingDesc}
                onChange={(e) => setServingDesc(e.target.value)}
              />
            </label>
          </div>

          {byServing && (
            <div className="tiny faint">
              Logged in servings only. Enter how many you had and the calories multiply up — there
              is no weight on record to convert from.
            </div>
          )}
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name || !kcal}>
            {busy ? <span className="spinner" /> : 'Next'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
