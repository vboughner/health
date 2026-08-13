import { macroSplit } from '../nutrition';

/** Macro split as a single stacked bar, labelled with percentages of calories. */
export function MacroBar({
  protein_g,
  fat_g,
  carb_g,
  compact = false,
}: {
  protein_g: number;
  fat_g: number;
  carb_g: number;
  compact?: boolean;
}) {
  const split = macroSplit({ protein_g, fat_g, carb_g });
  const empty = split.protein + split.fat + split.carb === 0;

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
