import { useState, FormEvent } from 'react';
import { api } from '../api';
import type { Food } from '../types';
import { LogSheet } from './LogSheet';

/**
 * Escape hatch for anything USDA doesn't have — home cooking, a friend's recipe,
 * a label read off a package. Saved as a normal food, so it turns up in search and
 * quick picks afterwards.
 */
export function ManualFood({
  onClose,
  onLogged,
}: {
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
  const [created, setCreated] = useState<Food | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ food: Food }>('/foods', {
        name: name.trim(),
        kcal_per_100g: Number(kcal),
        protein_g: num(protein),
        fat_g: num(fat),
        carb_g: num(carb),
        serving_grams: servingGrams ? Number(servingGrams) : null,
        serving_desc: servingDesc.trim() || null,
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
    return <LogSheet food={created} onClose={onClose} onLogged={onLogged} />;
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-title">New food</div>
          <div className="faint tiny">Nutrition per 100 g</div>
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

          <div className="field-grid">
            <Field label="Calories" value={kcal} onChange={setKcal} required />
            <Field label="Protein g" value={protein} onChange={setProtein} />
            <Field label="Fat g" value={fat} onChange={setFat} />
            <Field label="Carbs g" value={carb} onChange={setCarb} />
          </div>

          <div className="field-grid">
            <Field label="Serving grams" value={servingGrams} onChange={setServingGrams} />
            <label className="field">
              <span className="field-label">Serving name</span>
              <input
                placeholder="1 bowl"
                value={servingDesc}
                onChange={(e) => setServingDesc(e.target.value)}
              />
            </label>
          </div>
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
