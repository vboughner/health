import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from './api';
import { todayIn } from './dates';
import type { User } from './types';
import { Login } from './screens/Login';
import { Today } from './screens/Today';
import { AddFood } from './screens/AddFood';
import { Trends } from './screens/Trends';
import { Goals } from './screens/Goals';
import { Settings } from './screens/Settings';
import { readSettings, writeSettings, type Settings as SettingsValue } from './settings';

type Tab = 'today' | 'add' | 'trends' | 'settings' | 'goals';

// Add food sits in the middle, where a thumb reaches without stretching — it is
// pressed more often than the other four together.
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Day', icon: '◎' },
  { id: 'goals', label: 'Goals', icon: '⌖' },
  { id: 'add', label: 'Add Food', icon: '＋' },
  { id: 'trends', label: 'Trends', icon: '▨' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
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
  // Read once at startup rather than on every render — nothing else on the device
  // writes it, so the copy in state is the authority for the session.
  const [settings, setSettings] = useState<SettingsValue>(readSettings);

  const changeSettings = useCallback((next: SettingsValue) => {
    setSettings(next);
    writeSettings(next);
  }, []);

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
            settings={settings}
            onReviewGoals={() => setTab('goals')}
            onOpenSettings={() => setTab('settings')}
          />
        )}
        {tab === 'add' && (
          <AddFood date={date} today={today} onChangeDate={setDate} onLogged={handleLogged} />
        )}
        {tab === 'trends' && (
          <Trends
            refreshKey={refreshKey}
            settings={settings}
            onOpenSettings={() => setTab('settings')}
          />
        )}
        {tab === 'settings' && (
          <Settings settings={settings} onChange={changeSettings} onLogout={logout} />
        )}
        {tab === 'goals' && (
          <Goals
            date={date}
            today={today}
            trackReview={settings.goals}
            // Stays on the plan rather than bouncing back to the day — you came here
            // to read it, and the review is recorded by the reading. The bump is so
            // the day screen shows its tick when you go back yourself.
            onReviewed={handleLogged}
          />
        )}
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
