import { useState, FormEvent } from 'react';
import { api } from '../api';
import type { User } from '../types';

export function Login({ onLoggedIn }: { onLoggedIn: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await api.login(username, password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in');
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="login stack" onSubmit={submit}>
        <div>
          <h1>Health</h1>
          <div className="sub">2400 cal &middot; 9am&ndash;7pm &middot; whole foods</div>
        </div>

        {error && <div className="error">{error}</div>}

        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'Log in'}
        </button>
      </form>
    </div>
  );
}
