import type { DaySummary } from '../types';

/** Where the top of the range sits, as a share of the bar — room to show going past it. */
const MAX_AT = 85;

export interface ProteinBarState {
  label: string;
  target: string | null;
  fill: number;
  band: { left: number; width: number } | null;
  inRange: boolean;
}

/**
 * The day's protein as a bar against its range. Pure, so every state is tested
 * without rendering.
 *
 * Above the maximum stays green and keeps filling: the September 2026 plan is about
 * getting enough, and too much protein is not the risk it tracks, so the bar never
 * warns. Zero-based, like every bar in this app.
 */
export function proteinBar(p: {
  grams: number;
  min: number | null;
  max: number | null;
  floor: boolean;
}): ProteinBarState {
  const label = `${p.grams}${p.floor ? '+' : ''} g`;
  if (p.min === null || p.max === null) {
    return { label, target: null, fill: 0, band: null, inRange: false };
  }

  const pct = (g: number) => Math.min(100, (g / p.max!) * MAX_AT);
  return {
    label,
    target: `${p.min}–${p.max} g`,
    fill: pct(p.grams),
    band: { left: pct(p.min), width: pct(p.max) - pct(p.min) },
    inRange: p.grams >= p.min,
  };
}

export function ProteinBar({ protein }: { protein: DaySummary['food']['protein'] }) {
  const s = proteinBar(protein);

  // No range: the figure alone, rather than a bar measured against nothing.
  if (!s.band) {
    return (
      <div className="protein">
        <div className="protein-head">
          <span className="protein-title">Protein</span>
          <span className="protein-value">{s.label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="protein">
      <div className="protein-head">
        <span className="protein-title">Protein</span>
        <span className="protein-value">
          {s.label} <span className="faint">of {s.target}</span>
        </span>
      </div>
      <div
        className="protein-bar"
        role="img"
        aria-label={`Protein ${s.label} of ${s.target}${s.inRange ? ', in range' : ''}`}
      >
        <div
          className="protein-band"
          style={{ left: `${s.band.left}%`, width: `${s.band.width}%` }}
        />
        <div
          className={s.inRange ? 'protein-fill protein-fill-in' : 'protein-fill'}
          style={{ width: `${s.fill}%` }}
        />
      </div>
    </div>
  );
}
