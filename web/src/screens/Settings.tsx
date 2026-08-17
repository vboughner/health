import { FEATURES, type Settings as SettingsValue } from '../settings';
import { GoalsForm } from '../components/GoalsForm';
import type { Goals } from '../types';

/**
 * What this account is aiming at, what it tracks, and the way out of the app.
 *
 * All of it lives on the account rather than the device now, so a change here follows
 * you to every phone and browser you sign in from — and needs the network to happen at
 * all. Nothing is queued: a toggle that could not be saved goes back where it was and
 * says so, rather than sitting there looking saved.
 */
export function Settings({
  settings,
  onChange,
  error,
  goals,
  onSaveGoals,
  onLogout,
}: {
  settings: SettingsValue;
  onChange: (next: SettingsValue) => void;
  /** Why the last toggle did not stick, if it did not. */
  error: string;
  goals: Goals;
  onSaveGoals: (goals: Goals, scope: 'from_today' | 'correction') => Promise<void>;
  onLogout: () => void;
}) {
  return (
    <div className="stack">
      <h1 className="screen-title">Settings</h1>

      {/* Track sits above Goals on purpose. The toggles decide which of the numbers
          below are being watched at all, and a dimmed figure reads as a consequence
          when its cause is already on screen above it — and as a glitch when it is not. */}
      <div className="card">
        <div className="card-title card-title-tight">Track</div>
        <div className="toggles">
          {FEATURES.map((f) => (
            <label className="toggle" key={f.key}>
              <span className="toggle-text">
                <span className="toggle-label">{f.label}</span>
                <span className="toggle-detail">{f.detail}</span>
              </span>
              <input
                type="checkbox"
                className="toggle-input"
                checked={settings[f.key]}
                onChange={(e) => onChange({ ...settings, [f.key]: e.target.checked })}
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </label>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="tiny faint toggle-note">
          Turning one off only hides it from the day. Nothing already logged is deleted, and it all
          comes back if you turn it on again.
        </div>
      </div>

      <GoalsForm goals={goals} tracked={settings} onSave={onSaveGoals} />

      <div className="tiny faint">
        These are settings for your account, not for this phone — they follow you to every device
        you sign in from, which means saving one needs a connection.
      </div>

      {/* Last on the page. Spaced by the stack alone, like everything else here. */}
      <div className="row row-end">
        <button className="btn-ghost tiny" onClick={onLogout}>
          Log Out
        </button>
      </div>
    </div>
  );
}
