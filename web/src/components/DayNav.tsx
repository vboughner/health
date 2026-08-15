import { addDays, dayLabel } from '../dates';

/**
 * Step between days. Arrows move one day; tapping the label opens the phone's
 * native date picker for jumping further back.
 *
 * On today there is no forward arrow and no Today button at all — there is nothing
 * ahead to look at, and an always-present disabled control is just clutter. The bar
 * still keeps a constant height either way, so stepping between days does not shove
 * the rest of the page up and down.
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
        {/* On today the label reads across the middle of the bar rather than sitting
            on the first of two lines, so it is laid over the top of both. The pair
            below stays in flow, invisible, holding exactly the height they hold on
            every other day — measured from the real strings rather than a hard-coded
            number, which would drift with font size or zoom — so the page underneath
            does not jump when stepping between days. */}
        {isToday && <span className="daynav-now">{dayLabel(date, today)}</span>}
        <span className={isToday ? 'daynav-ghost' : 'daynav-past'} aria-hidden={isToday}>
          {dayLabel(date, today)}
        </span>
        <span
          className={isToday ? 'daynav-date daynav-ghost' : 'daynav-date'}
          aria-hidden={isToday}
        >
          {date}
        </span>
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
