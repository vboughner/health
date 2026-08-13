import { addDays, dayLabel } from '../dates';

/**
 * Step between days. Arrows move one day; tapping the label opens the phone's
 * native date picker for jumping further back.
 *
 * On today there is no forward arrow and no Today button at all — there is nothing
 * ahead to look at, and an always-present disabled control is just clutter. The
 * label is absolutely centred so it stays put whatever sits on either side of it.
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

      {!isToday && (
        <div className="daynav-right">
          <button
            className="daynav-arrow"
            onClick={() => onChange(addDays(date, 1))}
            aria-label="Next day"
          >
            ›
          </button>
          <button className="daynav-today" onClick={() => onChange(today)}>
            Today
          </button>
        </div>
      )}
    </div>
  );
}
