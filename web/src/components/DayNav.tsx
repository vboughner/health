import { addDays, dayLabel, daysBetween } from '../dates';

/**
 * Step between days. Arrows move one day; tapping the label opens the phone's
 * native date picker for jumping further back.
 *
 * Forward is capped at today — there is nothing to see or record in the future,
 * and a disabled arrow says that more plainly than an empty screen would.
 */
export function DayNav({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (day: string) => void;
}) {
  const isToday = date === today;
  const canGoForward = daysBetween(today, date) < 0;

  return (
    <div className="daynav">
      <button
        className="daynav-arrow"
        onClick={() => onChange(addDays(date, -1))}
        aria-label="Previous day"
      >
        ‹
      </button>

      <label className="daynav-label">
        <span className={isToday ? '' : 'daynav-past'}>{dayLabel(date, today)}</span>
        {!isToday && <span className="daynav-date">{date}</span>}
        {/* A real date input, so the phone shows its own picker. */}
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Pick a date"
        />
      </label>

      <button
        className="daynav-arrow"
        onClick={() => onChange(addDays(date, 1))}
        disabled={!canGoForward}
        aria-label="Next day"
      >
        ›
      </button>

      <button
        className="daynav-today"
        onClick={() => onChange(today)}
        disabled={isToday}
        aria-label="Jump to today"
      >
        Today
      </button>
    </div>
  );
}
