import { macroSplit } from '../nutrition';

/**
 * How much of a day's calories the split is not speaking for, in words, or null
 * when it speaks for all of them.
 *
 * Shown at any amount rather than past some threshold: a day is either fully
 * accounted for or it is not, and a bar that goes quiet until things are bad
 * reads as a bar that was right all along.
 */
export function coverageNote(unknownKcal: number, totalKcal: number): string | null {
  if (unknownKcal <= 0) return null;
  return `${Math.round(unknownKcal)} of ${Math.round(totalKcal)} cal have no macros on record`;
}

/** Macro split as a single stacked bar, labelled with percentages of calories. */
export function MacroBar({
  protein_g,
  fat_g,
  carb_g,
  compact = false,
  unknownKcal = 0,
  totalKcal = 0,
}: {
  protein_g: number;
  fat_g: number;
  carb_g: number;
  compact?: boolean;
  /** Calories logged without macros. The bar keeps its meaning; a line below says this. */
  unknownKcal?: number;
  totalKcal?: number;
}) {
  const split = macroSplit({ protein_g, fat_g, carb_g });
  const empty = split.protein + split.fat + split.carb === 0;
  const note = coverageNote(unknownKcal, totalKcal);

  return (
    <div className="macro">
      <div className="macro-bar" role="img" aria-label={macroLabel(split)}>
        {empty ? (
          <div className="macro-seg macro-empty" style={{ width: '100%' }} />
        ) : (
          // Carb, protein, fat — the 80/10/10 order the diet is aimed at, so the
          // bar reads largest-to-smallest on a good day.
          <>
            <div className="macro-seg macro-carb" style={{ width: `${split.carb}%` }} />
            <div className="macro-seg macro-protein" style={{ width: `${split.protein}%` }} />
            <div className="macro-seg macro-fat" style={{ width: `${split.fat}%` }} />
          </>
        )}
      </div>

      {!compact && (
        <div className="macro-legend">
          <Legend color="carb" label="Carbs" pct={split.carb} />
          <Legend color="protein" label="Protein" pct={split.protein} />
          <Legend color="fat" label="Fat" pct={split.fat} />
        </div>
      )}

      {/* After the legend, not between it and the bar: the legend is the bar's own
          labelling, and this is a caveat about both of them. */}
      {!compact && note && <div className="tiny faint macro-note">{note}</div>}
    </div>
  );
}

// Percentages only — the gram figures made this too wide for a phone, and the
// calorie split is what the diet is actually judged on.
function Legend({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <div className="macro-legend-item">
      <span className={`macro-dot macro-${color}`} />
      <span className="macro-legend-label">{label}</span>
      <span className="macro-legend-value">{Math.round(pct)}%</span>
    </div>
  );
}

function macroLabel(split: { protein: number; fat: number; carb: number }): string {
  return `Carbs ${Math.round(split.carb)}%, protein ${Math.round(split.protein)}%, fat ${Math.round(split.fat)}%`;
}
