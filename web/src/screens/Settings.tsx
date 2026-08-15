import { FEATURES, type Settings as SettingsValue } from '../settings';

/**
 * What this phone tracks, and the way out of the app.
 *
 * The toggles only decide what the day screen shows. Nothing is deleted when one
 * goes off and nothing stops being recorded, so turning it back on brings the
 * history with it — worth saying on the page, because a switch labelled "record"
 * reads like it might throw something away.
 */
export function Settings({
  settings,
  onChange,
  onLogout,
}: {
  settings: SettingsValue;
  onChange: (next: SettingsValue) => void;
  onLogout: () => void;
}) {
  return (
    <div className="stack">
      <h1 className="screen-title">Settings</h1>

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
        <div className="tiny faint toggle-note">
          Turning one off only hides it from the day. Nothing already logged is deleted, and it all
          comes back if you turn it on again.
        </div>
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
