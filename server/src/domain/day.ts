/**
 * Local-time helpers. Pure — the clock is always passed in.
 *
 * Timestamps are stored as UTC epoch millis, but every question this app asks is a
 * local one: which day does this belong to, was the last bite before 7pm, how long
 * did I sleep. These functions are the only place that conversion happens.
 */

/** Which local calendar day an instant falls on, as YYYY-MM-DD. */
export function localDay(epochMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes since local midnight — 0 for 00:00, 1140 for 19:00. */
export function localMinutes(epochMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return get('hour') * 60 + get('minute');
}

/** Local wall-clock time as HH:MM. */
export function formatLocalTime(epochMs: number, timezone: string): string {
  const minutes = localMinutes(epochMs, timezone);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 'HH:MM' to minutes since midnight. */
export function parseHHMM(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}`);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time: ${value}`);

  return hours * 60 + minutes;
}

export interface EatingWindow {
  /** First bite, local HH:MM. Null when nothing has been logged yet. */
  first: string | null;
  /** Last bite, local HH:MM. */
  last: string | null;
  /** Minutes between first and last bite. Null when fewer than two entries. */
  spanMinutes: number | null;
  startedOnTime: boolean | null;
  endedOnTime: boolean | null;
  /** True only when both ends are known and both are within the target window. */
  compliant: boolean | null;
}

/**
 * Derive the day's actual eating window from food log timestamps, rather than asking
 * for it separately — the goals note prefers inferring this from the log.
 *
 * A day with nothing logged reports nulls, not a violation: no data is not the same
 * as a broken window. A day with a single entry can still be judged on both ends,
 * since that one bite is both the first and the last.
 */
export function eatingWindow(
  eatenAt: number[],
  timezone: string,
  windowStart: string,
  windowEnd: string,
): EatingWindow {
  if (eatenAt.length === 0) {
    return {
      first: null,
      last: null,
      spanMinutes: null,
      startedOnTime: null,
      endedOnTime: null,
      compliant: null,
    };
  }

  const minutes = eatenAt.map((t) => localMinutes(t, timezone)).sort((a, b) => a - b);
  const firstMin = minutes[0];
  const lastMin = minutes[minutes.length - 1];

  const startedOnTime = firstMin >= parseHHMM(windowStart);
  const endedOnTime = lastMin <= parseHHMM(windowEnd);

  return {
    first: minutesToHHMM(firstMin),
    last: minutesToHHMM(lastMin),
    spanMinutes: eatenAt.length > 1 ? lastMin - firstMin : null,
    startedOnTime,
    endedOnTime,
    compliant: startedOnTime && endedOnTime,
  };
}

/**
 * Hours slept, rounded to a tenth. Returns null unless both ends are recorded.
 * Sleeping across midnight is the normal case and needs no special handling —
 * both ends are absolute instants.
 */
export function sleepHours(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  if (end <= start) return null;
  return Math.round(((end - start) / 3_600_000) * 10) / 10;
}

/** The N calendar days ending at `endDay` inclusive, oldest first. */
export function dayRange(endDay: string, days: number): string[] {
  const result: string[] = [];
  // Noon UTC keeps the arithmetic clear of DST edges — we only read the date part.
  const end = new Date(`${endDay}T12:00:00Z`).getTime();

  for (let i = days - 1; i >= 0; i--) {
    result.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return result;
}

function minutesToHHMM(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
