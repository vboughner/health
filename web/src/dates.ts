/**
 * Calendar-day helpers for the client. Pure — the clock is always passed in.
 *
 * Days are YYYY-MM-DD strings throughout, matching what the API speaks. Arithmetic
 * goes through noon UTC so a DST shift can never push a date onto the wrong day.
 */

export function todayIn(timezone: string, now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(day: string, delta: number): string {
  const base = new Date(`${day}T12:00:00Z`).getTime();
  return new Date(base + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * A human label for the day nav. "Today" and "Yesterday" read faster than a date
 * for the two days that get looked at most.
 */
export function dayLabel(day: string, today: string): string {
  const delta = daysBetween(today, day);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';

  const date = fromDayString(day);
  // Within the past week the weekday alone is unambiguous and shorter.
  if (delta < 0 && delta > -7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    // Only show the year when it isn't the current one.
    year: day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
  });
}

/** Short form for the Add Food header, where "Today" would be ambiguous. */
export function shortDayLabel(day: string, today: string): string {
  const delta = daysBetween(today, day);
  if (delta === 0) return 'today';
  if (delta === -1) return 'yesterday';
  return fromDayString(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Parse YYYY-MM-DD as a local Date, avoiding the UTC shift `new Date(str)` applies. */
export function fromDayString(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Current wall-clock time as HH:MM, for prefilling a time input. */
export function nowTime(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Before this hour, lying down counts as the small hours of a night already in
 * progress rather than the start of the next one.
 */
export const NIGHT_SPLIT_HOUR = 12;

/**
 * Which day's record a bedtime stamped right now belongs to.
 *
 * A night is filed under the morning it ends, so lying down on Tuesday evening
 * belongs to Wednesday. Lying down at 00:30 is already Wednesday and belongs to
 * that same day — hence the noon split rather than a plain "tomorrow".
 */
export function bedtimeBelongsTo(timezone: string, now = new Date()): string {
  const day = todayIn(timezone, now.getTime());
  return now.getHours() >= NIGHT_SPLIT_HOUR ? addDays(day, 1) : day;
}

/**
 * Combine a day and an HH:MM into an epoch timestamp.
 *
 * Uses the browser's timezone, which is the user's own phone — the same assumption
 * the sleep inputs make. The server re-derives local_day from this using the
 * account's timezone, so the two agree as long as you're not logging from a
 * different zone than your account is set to.
 */
export function atTimeOn(day: string, hhmm: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}
