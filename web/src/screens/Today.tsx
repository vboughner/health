import { useState, useEffect } from 'react';
import { api } from '../api';
import type { User, DaySummary, DayEntry, Activity } from '../types';
import { CalorieHeader } from '../components/CalorieHeader';
import { MacroBar } from '../components/MacroBar';
import { WindowBar } from '../components/WindowBar';
import { CheckIn } from '../components/CheckIn';
import { WarningChip } from '../components/FoodRow';
import { WeightInput, SleepInput, ExerciseInput, ExerciseList } from '../components/DayInputs';

export function Today({
  user,
  refreshKey,
  onLogout,
}: {
  user: User;
  refreshKey: number;
  onLogout: () => void;
}) {
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api
      .get<DaySummary>('/summary/today')
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load today');
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, version]);

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ activities: Activity[] }>('/activities')
      .then((res) => {
        if (!cancelled) setActivities(res.activities);
      })
      .catch((err) => {
        if (!cancelled) console.error(err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const reload = () => setVersion((v) => v + 1);

  async function act<T>(fn: () => Promise<T>) {
    try {
      await fn();
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    }
  }

  if (!summary) {
    return error ? (
      <div className="error">{error}</div>
    ) : (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }

  const { food, exercise, net, window: win, day } = summary;
  const patchDay = (patch: Partial<DayEntry>) => act(() => api.put(`/day/${summary.date}`, patch));

  return (
    <div className="stack">
      <div className="row">
        <h1 className="screen-title">Today</h1>
        <button className="btn-ghost tiny" onClick={onLogout}>
          Log out
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <CalorieHeader eaten={food.totals.kcal} budget={food.budget} />
      </div>

      <div className="card">
        <div className="card-title">Macros</div>
        <MacroBar
          protein_g={food.totals.protein_g}
          fat_g={food.totals.fat_g}
          carb_g={food.totals.carb_g}
        />
      </div>

      <div className="card">
        <div className="card-title">Eating window</div>
        <WindowBar window={win} />
      </div>

      <div className="card">
        <div className="card-title">Exercise</div>
        <div className="stat-row">
          <Stat value={exercise.total} label="burned" />
          <Stat value={exercise.target} label="target" dim />
          <Stat value={net.net} label="net intake" warn={net.tooLow} />
        </div>

        {net.tooLow && (
          <div className="warn-banner">
            Net intake is under 1200 today. On a heavy training day that is worth topping up rather
            than riding out.
          </div>
        )}

        <ExerciseList
          entries={exercise.entries}
          activities={activities}
          onDelete={(id) => act(() => api.del(`/log/exercise/${id}`))}
        />

        <ExerciseInput
          activities={activities}
          onAdd={(activity, minutes, kcal) =>
            act(() => api.post('/log/exercise', { activity, minutes, kcal, date: summary.date }))
          }
        />
      </div>

      <div className="card">
        <div className="card-title">Body</div>
        <div className="stack">
          <WeightInput weight={day.weight_lb} onSave={(lb) => patchDay({ weight_lb: lb })} />
          <SleepInput
            day={day}
            hours={day.sleep_hours}
            onSave={(start, end) => patchDay({ sleep_start: start, sleep_end: end })}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Daily check-in</div>
        <CheckIn day={day} window={win} onToggle={(field, value) => patchDay({ [field]: value })} />
      </div>

      <div className="card">
        <div className="card-title">Eaten today</div>
        {food.entries.length === 0 ? (
          <div className="empty">Nothing logged yet.</div>
        ) : (
          <div className="list">
            {food.entries.map((e) => (
              <div key={e.id} className="entry">
                <div className="entry-main">
                  <div className="entry-name">
                    {e.food_name}
                    <WarningChip reasons={e.processed_flags} />
                  </div>
                  <div className="entry-detail">
                    {formatTime(e.eaten_at, user.timezone)} · {formatAmount(e)}
                  </div>
                </div>
                <div className="entry-kcal">{Math.round(e.kcal)}</div>
                <button
                  className="entry-del"
                  onClick={() => act(() => api.del(`/log/food/${e.id}`))}
                  aria-label={`Delete ${e.food_name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  dim = false,
  warn = false,
}: {
  value: number;
  label: string;
  dim?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="stat">
      <div className={`stat-value ${dim ? 'faint' : ''} ${warn ? 'stat-warn' : ''}`}>
        {Math.round(value)}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function formatTime(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(epochMs));
}

function formatAmount(e: { quantity: number; unit: string; grams: number }): string {
  const qty = Number.isInteger(e.quantity) ? e.quantity : e.quantity.toFixed(1);
  if (e.unit === 'serving') return `${qty} × serving (${Math.round(e.grams)}g)`;
  return `${qty} ${e.unit}`;
}
