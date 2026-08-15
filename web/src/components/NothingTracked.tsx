/**
 * What a screen says when every feature has been switched off.
 *
 * Without it the day and the trends both render to an empty page, which reads as
 * the app being broken rather than as a choice that was made. It names where the
 * choice was made and offers the way back.
 */
export function NothingTracked({
  what,
  onOpenSettings,
}: {
  /** What there is nothing of, e.g. "to show for this day". */
  what: string;
  onOpenSettings: () => void;
}) {
  return (
    <div className="card">
      <div className="card-title">Nothing to track</div>
      <p className="empty-note">
        Every feature is switched off in Settings, so there is nothing {what}. Turn one back on and
        it returns, along with anything already logged against it.
      </p>
      <div className="row row-end">
        <button className="btn" onClick={onOpenSettings}>
          Open Settings
        </button>
      </div>
    </div>
  );
}
