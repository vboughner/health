import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from './api';
import { todayIn } from './dates';
import { clearLegacySettings, type Settings as SettingsValue } from './settings';
import type { Goals, User } from './types';
import { Login } from './screens/Login';
import { Today } from './screens/Today';
import { AddFood } from './screens/AddFood';
import { Trends } from './screens/Trends';
import { Goals as GoalsScreen } from './screens/Goals';
import { Settings } from './screens/Settings';

type Tab = 'today' | 'add' | 'trends' | 'settings' | 'goals';

// Add food sits in the middle, where a thumb reaches without stretching — it is
// pressed more often than the other four together.
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Day', icon: '◎' },
  { id: 'goals', label: 'Goals', icon: '⌖' },
  { id: 'add', label: 'Food', icon: '＋' },
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
  const [goals, setGoals] = useState<Goals | null>(null);
  const [settingsError, setSettingsError] = useState('');

  /**
   * Optimistic: the toggle moves at once and the request follows, because a switch
   * that waits for a round trip feels broken on a phone. A failure puts it back and
   * says why — nothing is queued for later, in line with sw.js, which caches the app
   * shell and deliberately no API writes.
   */
  const changeSettings = useCallback(
    async (next: SettingsValue) => {
      if (!user) return;

      // The user object from this render is what gets put back on failure.
      //
      // Reaching for `setUser(prev => ...)` and stashing `prev` in an outer variable
      // to roll back to would make the updater impure, which React does not allow:
      // updaters may be run more than once and replayed against a different base
      // state, so what got stashed is not reliably what was on screen when the request
      // went out. Closing over this render's value has none of that doubt.
      //
      // (An earlier version of this comment blamed StrictMode's double-invoke for
      // feeding the first call's output into the second. It does not — both calls see
      // the same base state, measured on React 19. The reason to avoid the updater is
      // purity, not that.)
      setUser({ ...user, features: next });

      try {
        await api.putFeatures(next);
        setSettingsError('');
      } catch (err) {
        setUser(user);
        setSettingsError(err instanceof Error ? err.message : 'Could not save that');
      }
    },
    [user],
  );

  const saveGoals = useCallback(async (next: Goals, scope: 'from_today' | 'correction') => {
    const { goals: saved } = await api.putGoals(next, scope);
    setGoals(saved);
  }, []);

  useEffect(() => {
    clearLegacySettings();

    api
      .me()
      .then(({ user, goals }) => {
        setUser(user);
        setGoals(goals);
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

  /**
   * Every page opens at the top. The document keeps one scroll offset across tabs,
   * so leaving the day scrolled to Bedtime would drop you into the middle of Trends.
   *
   * Deliberately keyed on the tab and the session, not on the data: stepping between
   * days inside Today must not scroll, which is the whole reason that screen holds
   * the previous day on the page rather than swapping in a spinner.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, user]);

  // A failed toggle leaves its message on Settings until something clears it. Every
  // tab switch goes through here rather than setTab directly, so leaving the tab and
  // coming back never re-shows a stale error for a request that is long past and may
  // since have succeeded.
  const changeTab = useCallback((next: Tab) => {
    setSettingsError('');
    setTab(next);
  }, []);

  function handleLoggedIn(next: User, nextGoals: Goals) {
    setUser(next);
    setGoals(nextGoals);
    setDate(todayIn(next.timezone));
    // Logging out never unmounts App, so the tab from the last session is still
    // sitting there. A new sign-in starts where the app starts.
    changeTab('today');
  }

  if (checking) {
    return (
      <div className="center-screen">
        <span className="spinner" />
      </div>
    );
  }

  if (!user || !date || !goals) return <Login onLoggedIn={handleLoggedIn} />;

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
            settings={user.features}
            onReviewGoals={() => changeTab('goals')}
            onOpenSettings={() => changeTab('settings')}
          />
        )}
        {tab === 'add' && (
          <AddFood date={date} today={today} onChangeDate={setDate} onLogged={handleLogged} />
        )}
        {tab === 'trends' && (
          <Trends
            refreshKey={refreshKey}
            settings={user.features}
            onOpenSettings={() => changeTab('settings')}
          />
        )}
        {tab === 'settings' && (
          <Settings
            settings={user.features}
            onChange={changeSettings}
            error={settingsError}
            goals={goals}
            onSaveGoals={saveGoals}
            onLogout={logout}
          />
        )}
        {tab === 'goals' && (
          <GoalsScreen
            date={date}
            today={today}
            trackReview={user.features.goals}
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
              onClick={() => changeTab(t.id)}
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
