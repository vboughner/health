import type { User } from '../types';

/**
 * Placeholder. The real Today screen — calories against budget, macro split, eating
 * window, exercise, weight, sleep, check-in — is built once the logging routes exist.
 */
export function Today({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ fontSize: 22 }}>Today</h1>
        <button className="btn-ghost tiny" onClick={onLogout}>
          Log out
        </button>
      </div>

      <div className="card">
        <div className="card-title">Signed in</div>
        <div className="row">
          <span>{user.username}</span>
          <span className="faint tiny">{user.timezone}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Targets</div>
        <div className="stack">
          <div className="row">
            <span className="muted">Calories</span>
            <span>{user.daily_kcal_budget} / day</span>
          </div>
          <div className="row">
            <span className="muted">Burn</span>
            <span>{user.daily_burn_target} / day</span>
          </div>
          <div className="row">
            <span className="muted">Eating window</span>
            <span>
              {user.window_start} – {user.window_end}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
