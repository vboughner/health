import { useState } from 'react';

const PLACEHOLDER = `## Calories

- what you are aiming at

## Eating window

- when you will eat`;

/**
 * One textarea for the whole plan.
 *
 * A box you type into rather than a form of sections and bullets: a plan is prose, and
 * editing a long one through per-bullet inputs on a phone is slower than typing.
 *
 * The placeholder is the only teaching there is for the format. It shows the two rules
 * that matter and nothing else, because there is nothing else.
 */
export function PlanEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (plan: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    try {
      await onSave(text);
    } catch (err) {
      // What you typed stays in the box. Nothing is queued to retry on your behalf.
      setError(err instanceof Error ? err.message : 'Could not save your plan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title card-title-tight">Your plan</div>
      <textarea
        className="plan-editor"
        value={text}
        placeholder={PLACEHOLDER}
        onChange={(e) => setText(e.target.value)}
        rows={18}
      />
      <div className="tiny faint">
        Start a section with <code>##</code> and a point with <code>-</code>. Everything else shows
        as you typed it.
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row row-end">
        <button className="btn-ghost tiny" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
    </div>
  );
}
