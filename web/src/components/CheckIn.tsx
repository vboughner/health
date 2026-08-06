import type { DayEntry, DaySummary } from '../types';

/**
 * The daily check-in from the goals note. Four boxes are self-reported; "done eating
 * by 7pm" is derived from the food log instead of asked, and shows as read-only.
 */
export function CheckIn({
  day,
  window: w,
  onToggle,
}: {
  day: DayEntry;
  window: DaySummary['window'];
  onToggle: (field: keyof DayEntry, value: boolean) => void;
}) {
  return (
    <div className="checks">
      <Check
        label="Reviewed goals this morning"
        checked={day.reviewed_morning}
        onChange={(v) => onToggle('reviewed_morning', v)}
      />
      <Check
        label="Reviewed goals tonight"
        checked={day.reviewed_night}
        onChange={(v) => onToggle('reviewed_night', v)}
      />
      <Derived
        label={`Done eating by ${w.target_end}`}
        state={w.endedOnTime}
        detail={w.last ? `last bite ${w.last}` : 'nothing logged'}
      />
      <Check label="No meat today" checked={day.no_meat} onChange={(v) => onToggle('no_meat', v)} />
      <Check
        label="No dairy today"
        checked={day.no_dairy}
        onChange={(v) => onToggle('no_dairy', v)}
      />
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className={checked ? 'check-label check-done' : 'check-label'}>{label}</span>
    </label>
  );
}

/** Not a checkbox — this one is computed, and pretending otherwise would invite lying to it. */
function Derived({
  label,
  state,
  detail,
}: {
  label: string;
  state: boolean | null;
  detail: string;
}) {
  const mark = state === null ? '·' : state ? '✓' : '✗';
  const cls = state === null ? 'check-unknown' : state ? 'check-auto-ok' : 'check-auto-bad';

  return (
    <div className="check check-readonly">
      <span className={`check-box ${cls}`} aria-hidden="true">
        {mark}
      </span>
      <span className="check-label">
        {label}
        <span className="faint tiny"> · {detail}</span>
      </span>
    </div>
  );
}
