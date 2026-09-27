import { useState, useEffect } from 'react';
import { api } from '../api';
import { isOn, nothingTracked, type Settings } from '../settings';
import {
  WeightChart,
  CalorieChart,
  ComplianceStrip,
  ProteinChart,
  WeeksStrip,
  type WeekState,
} from '../components/charts';
import { NothingTracked } from '../components/NothingTracked';

interface TrendDay {
  day: string;
  kcal: number | null;
  protein_g: number | null;
  protein_min_g: number | null;
  protein_max_g: number | null;
  burned: number | null;
  weight_lb: number | null;
  sleep_hours: number | null;
  window_compliant: boolean | null;
  // Null on days with nothing recorded at all — drawn as a blank cell, not a miss.
  goals_reviewed: boolean | null;
  // The goal in force on this day — not necessarily today's, on a range spanning a
  // change.
  budget: number;
}

interface Trends {
  from: string;
  to: string;
  days: TrendDay[];
  budget: number;
  burn_target: number;
  weights_per_week: number | null;
  weights_weeks: { week_start: string; count: number; target: number | null; state: WeekState }[];
  summary: {
    weight_trend_per_week: number | null;
    weight_smoothed: { day: string; value: number }[];
    latest_weight: number | null;
    avg_kcal: number | null;
    avg_protein_g: number | null;
    protein_days_with_target: number;
    protein_days_in_range: number;
    avg_burned: number | null;
    avg_sleep_hours: number | null;
    days_logged: number;
    days_under_budget: number;
    window_compliance: number;
    goals_review_rate: number;
    /** Days the rate is out of — the ones the strip draws a filled cell for. */
    goals_review_days: number;
    goals_review_streak: number;
  };
}

const RANGES = [14, 30, 90];

export function Trends({
  refreshKey,
  settings,
  onOpenSettings,
}: {
  refreshKey: number;
  /** Trends shows the history of whatever the day screen is tracking, and no more. */
  settings: Settings;
  onOpenSettings: () => void;
}) {
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

      {nothingTracked(settings) && (
        <NothingTracked what="to chart yet" onOpenSettings={onOpenSettings} />
      )}

      {/* Every panel below belongs to one of the toggles, and goes with it. The
          history is never deleted, so switching a feature back on brings its whole
          chart back rather than starting the record over.

          The tiles are ordered by feature, the same order the cards below run in, so
          switching one off leaves a gap in one place rather than two. */}
      {!nothingTracked(settings) && (
        <div className="tiles">
          {settings.weight && (
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
          )}
          {settings.food && <Tile value={s.avg_kcal ?? '—'} unit="cal" label="Avg eaten" />}
          {settings.food && <Tile value={`${s.window_compliance}`} unit="%" label="In window" />}
          {settings.exercise && (
            <Tile
              value={s.avg_burned ?? '—'}
              unit="cal"
              label="Avg burned"
              // Green once the average clears the daily burn target. The Averages
              // list used to print the target beside the figure; a tile has room
              // for one number, so it says whether the target was met instead.
              tone={s.avg_burned !== null && s.avg_burned >= data.burn_target ? 'good' : undefined}
            />
          )}
          {settings.sleep && <Tile value={s.avg_sleep_hours ?? '—'} unit="h" label="Avg sleep" />}
          {settings.goals && (
            <Tile value={s.goals_review_streak} unit="days" label="Goal review streak" />
          )}
        </div>
      )}

      {settings.weight && (
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
              {formatSigned(s.weight_trend_per_week)} lb/week against a −0.5 goal. The line is a
              7-day average — daily readings bounce more than the real change.
            </div>
          )}
        </div>
      )}

      {settings.food && (
        <div className="card">
          <div className="card-title">
            Calories <span className="faint">· budget {data.budget}</span>
          </div>
          <CalorieChart
            points={data.days.map((d) => ({ day: d.day, value: d.kcal, budget: d.budget }))}
          />
          <div className="tiny faint">
            {s.days_under_budget} of {s.days_logged} logged days at or under budget.
          </div>
        </div>
      )}

      {isOn(settings, 'protein') && (
        <div className="card">
          <div className="card-title">
            Protein
            {s.avg_protein_g !== null && <span className="faint"> · avg {s.avg_protein_g} g</span>}
          </div>
          <ProteinChart
            points={data.days.map((d) => ({
              day: d.day,
              value: d.protein_g,
              min: d.protein_min_g,
              max: d.protein_max_g,
            }))}
          />
          <div className="tiny faint">
            {s.protein_days_with_target > 0
              ? `${s.protein_days_in_range} of ${s.protein_days_with_target} logged days in range.`
              : 'No protein range set for these days — add one on Settings.'}
          </div>
        </div>
      )}

      {settings.food && (
        <div className="card">
          <div className="card-title">Eating window</div>
          <ComplianceStrip days={data.days.map((d) => ({ day: d.day, ok: d.window_compliant }))} />
        </div>
      )}

      {settings.exercise && (
        <div className="card">
          <div className="card-title">
            Weights
            {data.weights_per_week !== null && (
              <span className="faint"> · {data.weights_per_week} a week</span>
            )}
          </div>
          <WeeksStrip weeks={data.weights_weeks} />
        </div>
      )}

      {settings.goals && (
        <div className="card">
          <div className="card-title">
            Goals reviewed
            {/* Named rather than left as "of days", because the denominator is only
              the days with something on them — and at the start that is one day,
              where a bare "100%" claims far more than it knows. Dropped entirely
              when there are none, rather than reading "0% of 0 days". */}
            {s.goals_review_days > 0 && (
              <span className="faint">
                {' '}
                · {s.goals_review_rate}% of {s.goals_review_days}{' '}
                {s.goals_review_days === 1 ? 'day' : 'days'}
              </span>
            )}
          </div>
          <ComplianceStrip
            days={data.days.map((d) => ({ day: d.day, ok: d.goals_reviewed }))}
            labels={{ ok: 'Reviewed', bad: 'Not reviewed' }}
          />
        </div>
      )}

      {/* The Averages card that used to sit here said nothing the tiles above do not:
          eaten, burned and sleep are all tiles now, and the days-logged count is
          already in the line under the calorie chart. */}
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

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
