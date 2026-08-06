import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { User } from './types';
import { Login } from './screens/Login';
import { Today } from './screens/Today';

type Tab = 'today' | 'add' | 'trends';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '◎' },
  { id: 'add', label: 'Add food', icon: '＋' },
  { id: 'trends', label: 'Trends', icon: '▨' },
];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch((err) => {
        // 401 just means "not logged in yet" — anything else is worth seeing in the console.
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="center-screen">
        <span className="spinner" />
      </div>
    );
  }

  if (!user) return <Login onLoggedIn={setUser} />;

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return (
    <div className="app">
      <main className="app-main">
        {tab === 'today' && <Today user={user} onLogout={logout} />}
        {tab === 'add' && <div className="empty">Food search lands in the next step.</div>}
        {tab === 'trends' && <div className="empty">Charts land after that.</div>}
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
