import { useState } from 'react';
import type { Goals } from '../types';

type Scope = 'from_today' | 'correction';

/**
 * The three numbers the day is measured against.
 *
 * Saving asks how far back the change reaches, because the app cannot tell a typo
 * from a schedule change and the two want opposite things: fixing 2400 typed as 240
 * should repair every day it spoiled, while moving the window in September should
 * leave August judged by the window August was lived under.
 *
 * The choice only appears once something has actually changed, and disappears again
 * on cancel — a form that asks a question about an edit nobody made is noise.
 */
export function GoalsForm({
  goals,
  onSave,
}: {
  goals: Goals;
  onSave: (goals: Goals, scope: Scope) => Promise<void>;
}) {
  const [budget, setBudget] = useState(String(goals.kcal_budget));
  const [burn, setBurn] = useState(String(goals.burn_target));
  const [start, setStart] = useState(goals.window_start);
  const [end, setEnd] = useState(goals.window_end);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const edited: Goals = {
    kcal_budget: Number(budget),
    burn_target: Number(burn),
    window_start: start,
    window_end: end,
  };

  const changed =
    edited.kcal_budget !== goals.kcal_budget ||
    edited.burn_target !== goals.burn_target ||
    edited.window_start !== goals.window_start ||
    edited.window_end !== goals.window_end;

  function reset() {
    setBudget(String(goals.kcal_budget));
    setBurn(String(goals.burn_target));
    setStart(goals.window_start);
    setEnd(goals.window_end);
    setAsking(false);
    setError('');
  }

  async function save(scope: Scope) {
    setBusy(true);
    try {
      await onSave(edited, scope);
      setAsking(false);
      setError('');
    } catch (err) {
      // Edits stay on screen: you pressed a button, and you can press it again.
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title card-title-tight">Goals</div>

      <div className="field-rows">
        <label className="field-row">
          <span className="field-label">Calorie budget</span>
          <span className="field-input">
            <input
              type="number"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <span className="field-unit">cal</span>
          </span>
        </label>

        <label className="field-row">
          <span className="field-label">Burn target</span>
          <span className="field-input">
            <input
              type="number"
              inputMode="numeric"
              value={burn}
              onChange={(e) => setBurn(e.target.value)}
            />
            <span className="field-unit">cal</span>
          </span>
        </label>

        <div className="field-row">
          <span className="field-label">Eating window</span>
          <span className="field-input">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <span className="field-unit">to</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {changed && !asking && (
        <div className="row row-end">
          <button className="btn-ghost tiny" onClick={reset} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => setAsking(true)} disabled={busy}>
            Save
          </button>
        </div>
      )}

      {asking && (
        <div className="stack-tight">
          <div className="tiny faint">
            Past days are judged by the goals you had at the time. Which is this?
          </div>
          <div className="row row-end">
            <button className="btn" onClick={() => save('from_today')} disabled={busy}>
              From today onward
            </button>
            <button className="btn-ghost tiny" onClick={() => save('correction')} disabled={busy}>
              Fix a mistake — apply to past days too
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
