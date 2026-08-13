import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from './api';
import { todayIn } from './dates';
import type { User } from './types';
import { Login } from './screens/Login';
import { Today } from './screens/Today';
import { AddFood } from './screens/AddFood';
import { Trends } from './screens/Trends';
import { Goals } from './screens/Goals';

type Tab = 'today' | 'add' | 'trends';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Day', icon: '◎' },
  { id: 'add', label: 'Add food', icon: '＋' },
  { id: 'trends', label: 'Trends', icon: '▨' },
];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('today');
  // A full-screen overlay rather than a fourth tab: reviewing the plan is a thing
  // you do occasionally, not a place you navigate between.
  const [showGoals, setShowGoals] = useState(false);
  // Bumped whenever something is logged, so screens reload when switched back to.
  const [refreshKey, setRefreshKey] = useState(0);
  // The day being viewed and logged to. Shared across tabs so that picking a past
  // day and then adding food puts the food on that day, not on today.
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        setDate(todayIn(user.timezone));
      })
      .catch((err) => {
        // 401 just means "not logged in yet" — anything else is worth seeing.
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setChecking(false));
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const handleLogged = useCallback(() => setRefreshKey((k) => k + 1), []);

  function handleLoggedIn(next: User) {
    setUser(next);
    setDate(todayIn(next.timezone));
  }

  if (checking) {
    return (
      <div className="center-screen">
        <span className="spinner" />
      </div>
    );
  }

  if (!user || !date) return <Login onLoggedIn={handleLoggedIn} />;

  // Recomputed on render rather than stored, so leaving the app open past
  // midnight doesn't leave "Today" pointing at yesterday.
  const today = todayIn(user.timezone);

  return (
    <div className="app">
      <main className="app-main">
        {showGoals && (
          <Goals
            date={date}
            today={today}
            onBack={() => setShowGoals(false)}
            onReviewed={handleLogged}
          />
        )}

        {!showGoals && tab === 'today' && (
          <Today
            user={user}
            date={date}
            today={today}
            onChangeDate={setDate}
            refreshKey={refreshKey}
            onLogout={logout}
            onReviewGoals={() => setShowGoals(true)}
          />
        )}
        {!showGoals && tab === 'add' && (
          <AddFood date={date} today={today} onChangeDate={setDate} onLogged={handleLogged} />
        )}
        {!showGoals && tab === 'trends' && <Trends refreshKey={refreshKey} />}
      </main>

      <nav className="tabbar">
        <div className="tabbar-inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => {
                setShowGoals(false);
                setTab(t.id);
              }}
            >
              <span className="tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
