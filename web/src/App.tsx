import { useEffect, useState, useCallback, useRef } from 'react';
import { api, ApiError } from './api';
import { todayIn, appDay, followRollover } from './dates';
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

  // Both days, kept current across a night with the app left open. `today` is the
  // calendar day and labels everything; `currentDay` is the day the screen should
  // be sitting on, which between midnight and 4am is still yesterday.
  const clock = useCurrentDay(user?.timezone ?? null);
  const currentDay = clock?.appDay ?? null;

  /**
   * Carry the shown day forward when the day turns underneath us.
   *
   * The ref holds the app-day as of the last turn, which is what decides whether the
   * screen was following the current day or parked on one you chose — `followRollover`
   * moves the first and leaves the second alone. On the first run there is no previous
   * day to compare against and the day was only just seeded, so it records and stops.
   */
  const lastAppDay = useRef<string | null>(null);

  useEffect(() => {
    if (currentDay === null) return;

    const previous = lastAppDay.current;
    lastAppDay.current = currentDay;
    if (previous === null || previous === currentDay) return;

    setDate((shown) => (shown === null ? shown : followRollover(shown, previous, currentDay)));
  }, [currentDay]);

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
        setDate(appDay(user.timezone));
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
    setDate(appDay(next.timezone));
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

  // Derived on render, so it is never stale relative to the clock that drives it —
  // and `useCurrentDay` is what guarantees a render actually happens when the day
  // turns. Deriving alone was not enough: nothing re-rendered overnight, so "Today"
  // sat over yesterday's entries until something was tapped.
  const today = clock?.today ?? todayIn(user.timezone);

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

interface CurrentDay {
  /** The literal calendar day. What every label and DayNav compare against. */
  today: string;
  /** The day the screen should be on. Trails `today` between midnight and 4am. */
  appDay: string;
}

/**
 * The current day, kept current.
 *
 * Both values are derived from a timestamp in state rather than stored, so they are
 * always consistent with each other and a render can never show a half-updated pair.
 * The state exists only to force the render: it moves when — and only when — one of
 * the two days has actually changed, which is twice a day rather than once a minute.
 *
 * A phone sleeps its timers, so the interval alone would not fire on the way back
 * from an overnight suspend; `visibilitychange` covers picking the phone up and
 * `focus` covers a desktop tab. Between them the day is right within a minute of
 * turning, and immediately on being looked at.
 */
function useCurrentDay(timezone: string | null): CurrentDay | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timezone) return;

    const sync = () => {
      const at = Date.now();
      // Computed outside the updater: React may run an updater more than once, and
      // one that reads the clock itself would not be pure.
      setNow((prev) => (dayKey(timezone, prev) === dayKey(timezone, at) ? prev : at));
    };

    sync();

    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };

    const timer = window.setInterval(sync, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
    };
  }, [timezone]);

  if (!timezone) return null;
  return { today: todayIn(timezone, now), appDay: appDay(timezone, new Date(now)) };
}

/** The pair of days at an instant, as one string, for asking whether they moved. */
function dayKey(timezone: string, at: number): string {
  return `${todayIn(timezone, at)}|${appDay(timezone, new Date(at))}`;
}
