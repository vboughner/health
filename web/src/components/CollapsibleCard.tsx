import { useState, type ReactNode } from 'react';

/**
 * A card whose heading folds the body away.
 *
 * The choice is remembered per card, in localStorage. Switching tabs unmounts the
 * day screen entirely, so component state alone would spring every section back
 * open on the way back from Add food — which reads as the collapse not having
 * worked rather than as a deliberate reset. It is a per-phone display preference,
 * so it has no business on the server.
 *
 * A collapsed card still says something: `summary` takes the one figure worth
 * knowing without opening it, so folding a section away costs a detail rather than
 * the whole picture.
 */
export function CollapsibleCard({
  id,
  title,
  summary,
  children,
}: {
  /** Storage key for the open/closed choice. Stable across renames of the title. */
  id: string;
  title: ReactNode;
  /** Shown beside the title only while collapsed. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id));

  function toggle() {
    const next = !open;
    setOpen(next);
    writeOpen(id, next);
  }

  return (
    <div className="card">
      <button
        type="button"
        className={open ? 'card-toggle' : 'card-toggle card-toggle-closed'}
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="card-title card-title-flush">{title}</span>
        {!open && summary !== undefined && <span className="card-summary">{summary}</span>}
        <span className="card-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && children}
    </div>
  );
}

const KEY = (id: string) => `health:card-open:${id}`;

/** Open unless it was explicitly closed — a first run should show everything. */
function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(KEY(id)) !== 'closed';
  } catch {
    // Private mode and similar can throw on access. A section that will not
    // remember being closed is better than a screen that will not render.
    return true;
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    localStorage.setItem(KEY(id), open ? 'open' : 'closed');
  } catch {
    /* see readOpen */
  }
}
