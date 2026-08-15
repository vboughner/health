import { useState, FormEvent } from 'react';
import { api } from '../api';
import type { User } from '../types';

export function Login({ onLoggedIn }: { onLoggedIn: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
          <blockquote className="sub epigraph">
            &ldquo;Eat food. Not too much. Mostly plants.&rdquo; <cite>Michael Pollan</cite>
          </blockquote>
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

        {/* The reveal is a button inside the field rather than beside it, so the
            field keeps the full width of the one above it. Typing a password you
            cannot see on a phone keyboard is how you end up at "wrong password"
            twice over a typo. */}
        <div className="password-field">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="password-reveal"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? '🙈' : '👁'}
          </button>
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'Log In'}
        </button>
      </form>
    </div>
  );
}
