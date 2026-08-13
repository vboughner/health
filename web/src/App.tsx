import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from './api';
import { todayIn } from './dates';
import type { User } from './types';
import { Login } from './screens/Login';
import { Today } from './screens/Today';
import { AddFood } from './screens/AddFood';
import { Trends } from './screens/Trends';
import { Goals } from './screens/Goals';

type Tab = 'today' | 'add' | 'trends' | 'goals';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Day', icon: '◎' },
  { id: 'add', label: 'Add food', icon: '＋' },
  { id: 'trends', label: 'Trends', icon: '▨' },
  { id: 'goals', label: 'Goals', icon: '⌖' },
];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('today');
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
        {tab === 'today' && (
          <Today
            user={user}
            date={date}
            today={today}
            onChangeDate={setDate}
            refreshKey={refreshKey}
            onLogout={logout}
          />
        )}
        {tab === 'add' && (
          <AddFood date={date} today={today} onChangeDate={setDate} onLogged={handleLogged} />
        )}
        {tab === 'trends' && <Trends refreshKey={refreshKey} />}
        {tab === 'goals' && <Goals date={date} today={today} onReviewed={handleLogged} />}
      </main>

      <nav className="tabbar">
        <div className="tabbar-inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
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
