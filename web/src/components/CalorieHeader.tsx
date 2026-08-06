/** Calories eaten against the day's budget, with the remainder called out. */
export function CalorieHeader({ eaten, budget }: { eaten: number; budget: number }) {
  const remaining = Math.round(budget - eaten);
  const pct = budget > 0 ? Math.min(100, (eaten / budget) * 100) : 0;
  const over = remaining < 0;

  return (
    <div className="kcal">
      <div className="kcal-numbers">
        <div>
          <div className="kcal-big">{Math.round(eaten)}</div>
          <div className="kcal-label">eaten</div>
        </div>
        <div className="kcal-right">
          <div className={`kcal-big ${over ? 'kcal-over' : ''}`}>
            {over ? `+${Math.abs(remaining)}` : remaining}
          </div>
          <div className="kcal-label">{over ? 'over budget' : 'left today'}</div>
        </div>
      </div>

      <div className="kcal-track">
        <div className={`kcal-fill ${over ? 'kcal-fill-over' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="tiny faint">of {budget} cal</div>
    </div>
  );
}
