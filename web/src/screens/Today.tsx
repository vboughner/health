import { useState, useEffect } from 'react';
import { api } from '../api';
import { bedtimeBelongsTo, shortDayLabel } from '../dates';
import type { User, DaySummary, DayEntry, Activity } from '../types';
import { CalorieHeader } from '../components/CalorieHeader';
import { MacroBar } from '../components/MacroBar';
import { WindowBar } from '../components/WindowBar';
import { DayNav } from '../components/DayNav';
import { WarningChip } from '../components/FoodRow';
import { WeightInput, SleepInput, ExerciseInput, ExerciseList } from '../components/DayInputs';

export function Today({
  user,
  date,
  today,
  onChangeDate,
  refreshKey,
  onLogout,
}: {
  user: User;
  date: string;
  today: string;
  onChangeDate: (day: string) => void;
  refreshKey: number;
  onLogout: () => void;
}) {
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api
      .get<DaySummary>(`/summary/${date}`)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load that day');
      });

    return () => {
      cancelled = true;
    };
  }, [date, refreshKey, version]);

  // Clear a stale confirmation when the day changes out from under it.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  async function act<T>(fn: () => Promise<T>) {
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    }
  }

  const nav = <DayNav date={date} today={today} onChange={onChangeDate} />;

  // Only the very first load has nothing to show.
  if (!summary) {
    return (
      <div className="stack">
        {nav}
        {error ? (
          <div className="error">{error}</div>
        ) : (
          <div className="empty">
            <span className="spinner" />
          </div>
        )}
      </div>
    );
  }

  // Stepping to another day keeps the previous day on screen, dimmed, until the new
  // one arrives. Swapping it for a spinner collapsed the page to a couple of rows and
  // back, which reads as a flicker and throws away the scroll position.
  //
  // Everything below the nav therefore renders from `shown` — the day we actually
  // have — never from `date`, which may already point at the day being fetched. Only
  // DayNav follows `date`, so the arrows stay responsive. That keeps the dimming
  // cosmetic: a write during the gap still lands on the day on screen.
  const stale = summary.date !== date;
  const shown = summary.date;
  const showingToday = shown === today;

  const { food, exercise, window: win, day } = summary;
  const patchDay = (patch: Partial<DayEntry>) => act(() => api.put(`/day/${shown}`, patch));

  /**
   * File tonight's bedtime under the night it ends, and say where it went.
   *
   * That is usually tomorrow, which is not the day on screen — so this reloads only
   * when the write touches what is displayed, and always reports the outcome, since
   * otherwise the press would look like it did nothing.
   */
  async function stampBedtime() {
    const on = bedtimeBelongsTo(user.timezone);
    try {
      await api.put(`/day/${on}`, { sleep_start: Date.now() });
      setNotice(
        on === shown ? 'Bedtime saved.' : `Bedtime saved for ${shortDayLabel(on, today)}'s night.`,
      );
      if (on === shown) setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <h1 className="screen-title">{showingToday ? 'Today' : 'Day'}</h1>
        <button className="btn-ghost tiny" onClick={onLogout}>
          Log out
        </button>
      </div>

      {nav}

      {error && <div className="error">{error}</div>}

      <div className={stale ? 'stack day-body day-body-stale' : 'stack day-body'} aria-busy={stale}>
        <div className="card">
          <CalorieHeader eaten={food.totals.kcal} budget={food.budget} isToday={date === today} />
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
          <div className="card-title">{showingToday ? 'Eaten today' : 'Eaten'}</div>
          {food.entries.length === 0 ? (
            <div className="empty">Nothing logged.</div>
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

        <div className="card">
          <div className="card-title">Exercise</div>
          <div className="stat-row">
            <Stat value={exercise.total} label="burned" />
            <Stat value={exercise.target} label="target" dim />
          </div>

          <ExerciseList
            entries={exercise.entries}
            activities={activities}
            onDelete={(id) => act(() => api.del(`/log/exercise/${id}`))}
          />

          <ExerciseInput
            activities={activities}
            onAdd={(activity, minutes) =>
              act(() => api.post('/log/exercise', { activity, minutes, date: shown }))
            }
          />
        </div>

        <div className="card">
          <div className="card-title">Body</div>
          <div className="stack">
            <WeightInput
              key={`w-${shown}`}
              weight={day.weight_lb}
              onSave={(lb) => patchDay({ weight_lb: lb })}
            />
            <SleepInput
              key={`s-${shown}`}
              day={day}
              hours={day.sleep_hours}
              isToday={showingToday}
              onSave={(start, end) => patchDay({ sleep_start: start, sleep_end: end })}
              onStampWake={() => patchDay({ sleep_end: Date.now() })}
              onStampBed={stampBedtime}
            />
            {notice && <div className="toast tiny">{notice}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, dim = false }: { value: number; label: string; dim?: boolean }) {
  return (
    <div className="stat">
      <div className={`stat-value ${dim ? 'faint' : ''}`}>{Math.round(value)}</div>
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
