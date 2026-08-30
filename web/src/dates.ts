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
 * An existing timestamp as HH:MM — the inverse of `atTimeOn`, for prefilling a
 * time input with a time already saved. Browser timezone, as `atTimeOn` is, so
 * editing a time and saving it back is a round trip that changes nothing.
 */
export function timeOf(epochMs: number): string {
  return nowTime(new Date(epochMs));
}

/**
 * The local hour on a 24-hour clock, read in the given timezone.
 *
 * Both of the night-time decisions below need it, and both need it in the account's
 * zone rather than the browser's: taking the day off one clock and the hour off the
 * other splits the night at the wrong moment for anyone signed in from somewhere
 * their account is not set to.
 */
function hourIn(timezone: string, now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
}

/**
 * Before this hour, lying down counts as the small hours of a night already in
 * progress rather than the start of the next one.
 */
export const NIGHT_SPLIT_HOUR = 12;

/**
 * Before this hour the screen has not turned over to the new date yet — the evening
 * is still going, whatever the calendar says.
 *
 * Deliberately not NIGHT_SPLIT_HOUR. That one answers which evening a bedtime
 * belongs to and splits at noon, which as a rollover would leave the day on screen
 * a day behind until lunchtime. Two different questions that happen to both be
 * about the night.
 */
export const DAY_ROLLOVER_HOUR = 4;

/**
 * The day the app should be sitting on right now: the calendar day, except in the
 * small hours, when it is still the evening you have not gone to bed on yet.
 *
 * This does not replace `todayIn` and is not what anything is labelled with. `today`
 * stays the literal calendar day, so between midnight and 4am the two disagree and
 * the nav honestly reads "Yesterday" over the entries you are still adding to —
 * with the forward arrow and the Today button both right there.
 */
export function appDay(timezone: string, now = new Date()): string {
  const day = todayIn(timezone, now.getTime());
  return hourIn(timezone, now) >= DAY_ROLLOVER_HOUR ? day : addDays(day, -1);
}

/**
 * Which day to show once the rollover has happened.
 *
 * Only a screen that was following the current day moves with it. A day you stepped
 * back to on purpose stays where you put it: picking the phone up in the morning
 * should not throw away where you had got to.
 */
export function followRollover(date: string, lastAppDay: string, nextAppDay: string): string {
  return date === lastAppDay ? nextAppDay : date;
}

/**
 * Which day's record a bedtime stamped right now belongs to.
 *
 * Each field is filed under the calendar day you did it on: bedtime on the evening
 * you went to bed, wake time on the morning you got up. So an evening stamp is
 * simply today. Past midnight it belongs to the evening that just ended — hence the
 * noon split rather than a plain "today".
 */
export function bedtimeBelongsTo(timezone: string, now = new Date()): string {
  const day = todayIn(timezone, now.getTime());
  return hourIn(timezone, now) >= NIGHT_SPLIT_HOUR ? day : addDays(day, -1);
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
