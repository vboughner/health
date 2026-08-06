import { describe, it, expect } from 'vitest';
import {
  localDay,
  localMinutes,
  formatLocalTime,
  parseHHMM,
  eatingWindow,
  sleepHours,
  dayRange,
} from '../domain/day';

const LA = 'America/Los_Angeles';

/** Build an epoch ms value from a local wall-clock time in a given zone. */
function at(day: string, hhmm: string, offset: string): number {
  return new Date(`${day}T${hhmm}:00${offset}`).getTime();
}

describe('localDay', () => {
  it('reports the local date, not the UTC one', () => {
    // 8pm Pacific on Jan 15 is already Jan 16 in UTC. The day it belongs to is the 15th.
    const evening = at('2026-01-15', '20:00', '-08:00');

    expect(localDay(evening, LA)).toBe('2026-01-15');
    expect(localDay(evening, 'UTC')).toBe('2026-01-16');
  });

  it('handles the first minute of a local day', () => {
    expect(localDay(at('2026-03-01', '00:00', '-08:00'), LA)).toBe('2026-03-01');
  });

  it('handles the last minute of a local day', () => {
    expect(localDay(at('2026-03-01', '23:59', '-08:00'), LA)).toBe('2026-03-01');
  });

  it('zero-pads month and day', () => {
    expect(localDay(at('2026-01-05', '12:00', '-08:00'), LA)).toBe('2026-01-05');
  });

  it('rolls the year over correctly', () => {
    const nye = at('2025-12-31', '23:30', '-08:00');
    expect(localDay(nye, LA)).toBe('2025-12-31');
    expect(localDay(nye, 'UTC')).toBe('2026-01-01');
  });
});

describe('localMinutes and formatLocalTime', () => {
  it('counts minutes since local midnight', () => {
    expect(localMinutes(at('2026-01-15', '00:00', '-08:00'), LA)).toBe(0);
    expect(localMinutes(at('2026-01-15', '09:00', '-08:00'), LA)).toBe(540);
    expect(localMinutes(at('2026-01-15', '19:00', '-08:00'), LA)).toBe(1140);
    expect(localMinutes(at('2026-01-15', '23:59', '-08:00'), LA)).toBe(1439);
  });

  it('formats as HH:MM with zero padding', () => {
    expect(formatLocalTime(at('2026-01-15', '07:05', '-08:00'), LA)).toBe('07:05');
    expect(formatLocalTime(at('2026-01-15', '19:30', '-08:00'), LA)).toBe('19:30');
  });

  it('uses a 24-hour clock, not 12', () => {
    expect(formatLocalTime(at('2026-01-15', '13:00', '-08:00'), LA)).toBe('13:00');
    expect(formatLocalTime(at('2026-01-15', '00:30', '-08:00'), LA)).toBe('00:30');
  });

  describe('across daylight saving time', () => {
    // US DST began March 8 2026. Pacific is -08:00 before, -07:00 after.
    it('reads local wall-clock time correctly on either side of the change', () => {
      expect(formatLocalTime(at('2026-03-07', '09:00', '-08:00'), LA)).toBe('09:00');
      expect(formatLocalTime(at('2026-03-09', '09:00', '-07:00'), LA)).toBe('09:00');
    });

    it('assigns the right local day on either side of the change', () => {
      expect(localDay(at('2026-03-07', '20:00', '-08:00'), LA)).toBe('2026-03-07');
      expect(localDay(at('2026-03-09', '20:00', '-07:00'), LA)).toBe('2026-03-09');
    });

    it('assigns the right local day on the changeover day itself', () => {
      expect(localDay(at('2026-03-08', '23:00', '-07:00'), LA)).toBe('2026-03-08');
    });
  });
});

describe('parseHHMM', () => {
  it('parses valid times', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('09:00')).toBe(540);
    expect(parseHHMM('19:00')).toBe(1140);
    expect(parseHHMM('9:30')).toBe(570);
  });

  it('rejects malformed and out-of-range values', () => {
    expect(() => parseHHMM('25:00')).toThrow(/Invalid time/);
    expect(() => parseHHMM('12:60')).toThrow(/Invalid time/);
    expect(() => parseHHMM('noon')).toThrow(/Invalid time/);
    expect(() => parseHHMM('')).toThrow(/Invalid time/);
  });
});

describe('eatingWindow', () => {
  const day = (hhmm: string) => at('2026-01-15', hhmm, '-08:00');

  it('reports nulls for a day with nothing logged', () => {
    const w = eatingWindow([], LA, '09:00', '19:00');

    expect(w).toEqual({
      first: null,
      last: null,
      spanMinutes: null,
      startedOnTime: null,
      endedOnTime: null,
      compliant: null,
    });
  });

  it('marks a compliant day', () => {
    const w = eatingWindow([day('09:15'), day('13:00'), day('18:30')], LA, '09:00', '19:00');

    expect(w.first).toBe('09:15');
    expect(w.last).toBe('18:30');
    expect(w.spanMinutes).toBe(555);
    expect(w.compliant).toBe(true);
  });

  it('catches eating too early', () => {
    const w = eatingWindow([day('07:30'), day('18:00')], LA, '09:00', '19:00');

    expect(w.startedOnTime).toBe(false);
    expect(w.endedOnTime).toBe(true);
    expect(w.compliant).toBe(false);
  });

  it('catches eating too late', () => {
    const w = eatingWindow([day('09:30'), day('20:15')], LA, '09:00', '19:00');

    expect(w.startedOnTime).toBe(true);
    expect(w.endedOnTime).toBe(false);
    expect(w.compliant).toBe(false);
  });

  it('treats exactly 09:00 and exactly 19:00 as on time', () => {
    const w = eatingWindow([day('09:00'), day('19:00')], LA, '09:00', '19:00');
    expect(w.compliant).toBe(true);
  });

  it('judges both ends from a single entry', () => {
    const w = eatingWindow([day('20:00')], LA, '09:00', '19:00');

    expect(w.first).toBe('20:00');
    expect(w.last).toBe('20:00');
    expect(w.spanMinutes).toBeNull();
    expect(w.endedOnTime).toBe(false);
  });

  it('does not care what order the entries arrive in', () => {
    const shuffled = eatingWindow([day('18:30'), day('09:15'), day('13:00')], LA, '09:00', '19:00');
    const sorted = eatingWindow([day('09:15'), day('13:00'), day('18:30')], LA, '09:00', '19:00');

    expect(shuffled).toEqual(sorted);
  });
});

describe('sleepHours', () => {
  it('computes hours across midnight', () => {
    const bed = at('2026-01-15', '22:30', '-08:00');
    const wake = at('2026-01-16', '06:15', '-08:00');

    expect(sleepHours(bed, wake)).toBe(7.8);
  });

  it('returns null when either end is missing', () => {
    expect(sleepHours(null, Date.now())).toBeNull();
    expect(sleepHours(Date.now(), null)).toBeNull();
    expect(sleepHours(null, null)).toBeNull();
  });

  it('returns null rather than a negative span when the times are backwards', () => {
    const bed = at('2026-01-15', '22:30', '-08:00');
    const wake = at('2026-01-15', '06:15', '-08:00');

    expect(sleepHours(bed, wake)).toBeNull();
  });

  it('is unaffected by a DST change during the night', () => {
    // Clocks jumped forward at 2am on 2026-03-08, so 22:00 PST to 07:00 PDT is 8 hours.
    const bed = at('2026-03-07', '22:00', '-08:00');
    const wake = at('2026-03-08', '07:00', '-07:00');

    expect(sleepHours(bed, wake)).toBe(8);
  });
});

describe('dayRange', () => {
  it('returns N days ending at the given day, oldest first', () => {
    expect(dayRange('2026-01-15', 3)).toEqual(['2026-01-13', '2026-01-14', '2026-01-15']);
  });

  it('returns just the day itself for a range of one', () => {
    expect(dayRange('2026-01-15', 1)).toEqual(['2026-01-15']);
  });

  it('crosses a month boundary', () => {
    expect(dayRange('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('crosses a year boundary', () => {
    expect(dayRange('2026-01-01', 2)).toEqual(['2025-12-31', '2026-01-01']);
  });

  it('is not thrown off by a DST change inside the range', () => {
    const range = dayRange('2026-03-10', 5);

    expect(range).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('returns the requested number of days', () => {
    expect(dayRange('2026-06-15', 90)).toHaveLength(90);
  });
});
