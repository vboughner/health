import { useState, useEffect } from 'react';
import { api } from '../api';
import { WeightChart, CalorieChart, ComplianceStrip } from '../components/charts';

interface TrendDay {
  day: string;
  kcal: number | null;
  burned: number | null;
  weight_lb: number | null;
  sleep_hours: number | null;
  window_compliant: boolean | null;
}

interface Trends {
  from: string;
  to: string;
  days: TrendDay[];
  budget: number;
  burn_target: number;
  summary: {
    weight_trend_per_week: number | null;
    weight_smoothed: { day: string; value: number }[];
    latest_weight: number | null;
    avg_kcal: number | null;
    avg_burned: number | null;
    avg_sleep_hours: number | null;
    days_logged: number;
    days_under_budget: number;
    window_compliance: number;
    checkin_streak: number;
  };
}

const RANGES = [14, 30, 90];

export function Trends({ refreshKey }: { refreshKey: number }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Trends | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    api
      .get<Trends>(`/trends?days=${days}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load trends');
      });

    return () => {
      cancelled = true;
    };
  }, [days, refreshKey]);

  if (error) return <div className="error">{error}</div>;
  if (!data) {
    return (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }

  const s = data.summary;
  const target = -0.5; // the half-pound-a-week goal

  return (
    <div className="stack">
      <div className="row">
        <h1 className="screen-title">Trends</h1>
        <div className="seg seg-inline">
          {RANGES.map((r) => (
            <button
              key={r}
              className="seg-btn"
              aria-pressed={days === r}
              onClick={() => setDays(r)}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="tiles">
        <Tile
          value={s.weight_trend_per_week === null ? '—' : formatSigned(s.weight_trend_per_week)}
          unit="lb/wk"
          label="Weight trend"
          tone={
            s.weight_trend_per_week === null
              ? undefined
              : s.weight_trend_per_week <= target
                ? 'good'
                : s.weight_trend_per_week < 0
                  ? undefined
                  : 'warn'
          }
        />
        <Tile value={s.avg_kcal ?? '—'} unit="cal" label="Avg eaten" />
        <Tile value={`${s.window_compliance}`} unit="%" label="In window" />
        <Tile value={s.avg_sleep_hours ?? '—'} unit="h" label="Avg sleep" />
      </div>

      <div className="card">
        <div className="card-title">
          Weight
          {s.latest_weight !== null && <span className="faint"> · now {s.latest_weight} lb</span>}
        </div>
        <WeightChart
          points={data.days.map((d) => ({ day: d.day, value: d.weight_lb }))}
          smoothed={s.weight_smoothed}
        />
        {s.weight_trend_per_week !== null && (
          <div className="tiny faint">
            {formatSigned(s.weight_trend_per_week)} lb/week against a −0.5 goal. The line is a 7-day
            average — daily readings bounce more than the real change.
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          Calories <span className="faint">· budget {data.budget}</span>
        </div>
        <CalorieChart
          points={data.days.map((d) => ({ day: d.day, value: d.kcal }))}
          budget={data.budget}
        />
        <div className="tiny faint">
          {s.days_under_budget} of {s.days_logged} logged days at or under budget.
        </div>
      </div>

      <div className="card">
        <div className="card-title">Eating window</div>
        <ComplianceStrip days={data.days.map((d) => ({ day: d.day, ok: d.window_compliant }))} />
      </div>

      <div className="card">
        <div className="card-title">Averages</div>
        <div className="stack">
          <Line label="Calories eaten" value={s.avg_kcal} unit="cal" />
          <Line label="Calories burned" value={s.avg_burned} unit="cal" target={data.burn_target} />
          <Line label="Sleep" value={s.avg_sleep_hours} unit="h" />
          <Line label="Days logged" value={s.days_logged} unit={`of ${data.days.length}`} />
        </div>
      </div>
    </div>
  );
}

function Tile({
  value,
  unit,
  label,
  tone,
}: {
  value: string | number;
  unit: string;
  label: string;
  tone?: 'good' | 'warn';
}) {
  return (
    <div className="tile">
      <div className={`tile-value ${tone ? `tile-${tone}` : ''}`}>
        {value}
        <span className="tile-unit">{unit}</span>
      </div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function Line({
  label,
  value,
  unit,
  target,
}: {
  label: string;
  value: number | null;
  unit: string;
  target?: number;
}) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <span>
        {value === null ? <span className="faint">—</span> : value}
        <span className="faint tiny"> {unit}</span>
        {target !== undefined && <span className="faint tiny"> · target {target}</span>}
      </span>
    </div>
  );
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
