import { useState, useEffect } from 'react';
import { api } from '../api';
import { bedtimeBelongsTo, shortDayLabel } from '../dates';
import type { User, DaySummary, DayEntry, Activity } from '../types';
import { nothingTracked, type Settings as SettingsValue } from '../settings';
import { CalorieHeader } from '../components/CalorieHeader';
import { MacroBar } from '../components/MacroBar';
import { WindowBar } from '../components/WindowBar';
import { DayNav } from '../components/DayNav';
import { CollapsibleCard } from '../components/CollapsibleCard';
import { NothingTracked } from '../components/NothingTracked';
import { WarningChip } from '../components/FoodRow';
import {
  WeightInput,
  WakeInput,
  BedInput,
  ExerciseInput,
  ExerciseList,
} from '../components/DayInputs';

export function Today({
  user,
  date,
  today,
  onChangeDate,
  refreshKey,
  settings,
  onReviewGoals,
  onOpenSettings,
}: {
  user: User;
  date: string;
  today: string;
  onChangeDate: (day: string) => void;
  refreshKey: number;
  /** Which sections this phone shows. Everything stays recorded either way. */
  settings: SettingsValue;
  /** Opens the plan. The Goals screen is what records the review. */
  onReviewGoals: () => void;
  onOpenSettings: () => void;
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
   * Stamp the bedtime on the evening it belongs to — normally the day on screen, so
   * the Asleep field updates straight away and a second press overwrites it. Only
   * after midnight does it land on the evening that just ended, which is worth
   * saying out loud since the field being edited is then off screen.
   */
  async function stampBedtime() {
    const on = bedtimeBelongsTo(user.timezone);
    try {
      await api.put(`/day/${on}`, { sleep_start: Date.now() });
      if (on === shown) {
        setVersion((v) => v + 1);
      } else {
        setNotice(`Bedtime saved for ${shortDayLabel(on, today)} evening.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    }
  }

  // The page runs in the order the day does: what you weigh and when you got up,
  // what you burned, what you ate, how that ate broke down, then bedtime. The
  // calorie header stays on top of all of it — it is the one number worth seeing
  // before scrolling anywhere.
  return (
    <div className="stack">
      {nav}

      {error && <div className="error">{error}</div>}

      <div className={stale ? 'stack day-body day-body-stale' : 'stack day-body'} aria-busy={stale}>
        {nothingTracked(settings) && (
          <NothingTracked what="to show for this day" onOpenSettings={onOpenSettings} />
        )}

        {/* Everything food-derived travels together. The calorie header, the macro
            split and the eating window are all read off the food log, so with food
            switched off they would sit at zero rather than say anything — the
            section that is gone is the one that fed them. */}
        {settings.food && (
          <div className="card">
            <CalorieHeader eaten={food.totals.kcal} budget={food.budget} isToday={showingToday} />
          </div>
        )}

        {/* Morning holds two independent things, so it survives on either one alone —
            a weight is a morning thing whether or not the night before is tracked,
            and vice versa. Only with both off does the heading go too, rather than
            standing over nothing. */}
        {(settings.weight || settings.sleep) && (
          <div className="card">
            <div className="card-title">Morning</div>
            <div className="stack">
              {settings.weight && (
                <WeightInput
                  key={`w-${shown}`}
                  weight={day.weight_lb}
                  onSave={(lb) => patchDay({ weight_lb: lb })}
                />
              )}
              {settings.sleep && (
                <WakeInput
                  // Keyed on the value too, so a stamp that comes back from the server
                  // replaces what the input is holding instead of being ignored.
                  key={`s-${shown}-${day.sleep_end}`}
                  day={day}
                  hours={day.sleep_hours}
                  isToday={showingToday}
                  onSetTime={(field, at) => patchDay({ [field]: at })}
                  onStampWake={() => patchDay({ sleep_end: Date.now() })}
                />
              )}
            </div>
          </div>
        )}

        {/* The two long, scrolling sections fold away. Each keeps its headline
            figure in the heading while closed, so collapsing one costs the detail
            rather than the whole answer. */}
        {settings.exercise && (
          <CollapsibleCard
            id="exercise"
            title="Exercise"
            summary={`${Math.round(exercise.total)} of ${Math.round(exercise.target)} cal`}
          >
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
          </CollapsibleCard>
        )}

        {settings.food && (
          <CollapsibleCard
            id="eaten"
            title={showingToday ? 'Eaten today' : 'Eaten'}
            summary={food.entries.length === 1 ? '1 item' : `${food.entries.length} items`}
          >
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
          </CollapsibleCard>
        )}

        {/* Both halves are read off the same food log and are both about how the
            eating went rather than what it was, so they share a heading and fold
            away together. Collapsed, the heading keeps the window's two ends: the
            macros need three numbers to say anything, the window needs two. */}
        {settings.food && (
          <CollapsibleCard
            id="macros-window"
            title="Eating macros and window"
            summary={
              win.first !== null && win.last !== null ? `${win.first}–${win.last}` : undefined
            }
          >
            <MacroBar
              protein_g={food.totals.protein_g}
              fat_g={food.totals.fat_g}
              carb_g={food.totals.carb_g}
              unknownKcal={food.macro_unknown_kcal}
              totalKcal={food.totals.kcal}
            />
            <div className="card-split">
              <WindowBar window={win} />
            </div>
          </CollapsibleCard>
        )}

        {/* Like Morning, Bedtime holds two unrelated things and survives on either
            one. With both off there is no evening left to show. */}
        {(settings.sleep || settings.goals) && (
          <div className="card">
            <div className="card-title">Bedtime</div>
            <div className="stack">
              {settings.sleep && (
                <BedInput
                  key={`b-${shown}-${day.sleep_start}`}
                  day={day}
                  isToday={showingToday}
                  onSetTime={(field, at) => patchDay({ [field]: at })}
                  onStampBed={stampBedtime}
                />
              )}
              {/* Reading the plan is the last thing in the day, so the way in sits at
                  the end of it. The tick reports what the day already says rather than
                  doing anything: it is the Goals screen that records the review. */}
              {settings.goals && (
                <button
                  className="btn btn-inline-end"
                  onClick={onReviewGoals}
                  aria-label={
                    day.goals_reviewed ? 'Review goals, already reviewed' : 'Review goals'
                  }
                >
                  {day.goals_reviewed && (
                    <span className="btn-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  Review Goals
                </button>
              )}
              {notice && <div className="toast tiny">{notice}</div>}
            </div>
          </div>
        )}
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

export function formatAmount(e: {
  quantity: number;
  unit: string;
  grams: number;
  weight_unknown?: boolean;
  macros_unknown?: boolean;
}): string {
  // A quick entry has no amount to state: its quantity and unit are the shape the
  // table wants, not anything anyone chose. What it does have is a name and a
  // number of calories, both already on the row.
  if (e.macros_unknown) return 'calories only';

  const qty = Number.isInteger(e.quantity) ? e.quantity : e.quantity.toFixed(1);
  if (e.unit !== 'serving') return `${qty} ${e.unit}`;
  // A calorie-defined serving has grams only as bookkeeping — printing them would
  // be quoting a measurement nobody took.
  if (e.weight_unknown) return `${qty} × serving`;
  return `${qty} × serving (${Math.round(e.grams)}g)`;
}
