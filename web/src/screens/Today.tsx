import { useState, useEffect } from 'react';
import { api } from '../api';
import type { User, FoodLogEntry } from '../types';
import { CalorieHeader } from '../components/CalorieHeader';
import { MacroBar } from '../components/MacroBar';
import { WarningChip } from '../components/FoodRow';

export function Today({
  user,
  refreshKey,
  onLogout,
}: {
  user: User;
  refreshKey: number;
  onLogout: () => void;
}) {
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Bumped locally after a delete; refreshKey covers changes made on other screens.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ entries: FoodLogEntry[] }>('/log/food')
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load today');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, version]);

  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein_g: acc.protein_g + e.protein_g,
      fat_g: acc.fat_g + e.fat_g,
      carb_g: acc.carb_g + e.carb_g,
    }),
    { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 },
  );

  async function remove(id: number) {
    try {
      await api.del(`/log/food/${id}`);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that');
    }
  }

  if (loading) {
    return (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }

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
        <CalorieHeader eaten={totals.kcal} budget={user.daily_kcal_budget} />
      </div>

      <div className="card">
        <div className="card-title">Macros</div>
        <MacroBar {...totals} />
      </div>

      <div className="card">
        <div className="card-title">Eaten today</div>
        {entries.length === 0 ? (
          <div className="empty">Nothing logged yet.</div>
        ) : (
          <div className="list">
            {entries.map((e) => (
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
                  onClick={() => remove(e.id)}
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

function formatTime(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(epochMs));
}

function formatAmount(e: FoodLogEntry): string {
  const qty = Number.isInteger(e.quantity) ? e.quantity : e.quantity.toFixed(1);
  if (e.unit === 'serving') return `${qty} × serving (${Math.round(e.grams)}g)`;
  return `${qty} ${e.unit}`;
}
