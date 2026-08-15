import { describe, it, expect } from 'vitest';
import { windowVerdict } from '../components/WindowBar';
import type { DaySummary } from '../types';

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** A day with nothing logged, against the 9am–7pm target. */
function nothing(): DaySummary['window'] {
  return {
    first: null,
    last: null,
    spanMinutes: null,
    startedOnTime: null,
    endedOnTime: null,
    compliant: null,
    target_start: '09:00',
    target_end: '19:00',
  };
}

/** A day whose eating ran from `first` to `last`, judged as the server judges it. */
function ate(first: string, last: string, start = '09:00', end = '19:00'): DaySummary['window'] {
  const startedOnTime = mins(first) >= mins(start);
  const endedOnTime = mins(last) <= mins(end);

  return {
    first,
    last,
    // Null on a single entry, matching the server — the verdict must not need it.
    spanMinutes: first === last ? null : mins(last) - mins(first),
    startedOnTime,
    endedOnTime,
    compliant: startedOnTime && endedOnTime,
    target_start: start,
    target_end: end,
  };
}

describe('windowVerdict', () => {
  it('stays green with nothing logged — no data is not a violation', () => {
    expect(windowVerdict(nothing())).toEqual({ tone: 'ok', reasons: [] });
  });

  it('stays green when every bite landed inside the target', () => {
    expect(windowVerdict(ate('09:30', '18:45')).tone).toBe('ok');
  });

  it('turns amber for eating late inside a stretch no longer than the target', () => {
    // 10am to 8pm: an hour past 7pm, but still only ten hours of eating.
    expect(windowVerdict(ate('10:00', '20:00'))).toEqual({
      tone: 'warn',
      reasons: ['ate after 7pm'],
    });
  });

  it('holds amber at exactly the target length rather than tipping over', () => {
    // Ten hours on the nose. The boundary belongs to the gentler colour.
    expect(windowVerdict(ate('10:30', '20:30')).tone).toBe('warn');
  });

  it('turns red once the eating outruns the length of the window', () => {
    expect(windowVerdict(ate('09:00', '20:00')).tone).toBe('over'); // 11 hours
  });

  it('names the span, so red is distinguishable from amber by more than colour', () => {
    expect(windowVerdict(ate('09:00', '20:30')).reasons).toEqual([
      'ate after 7pm',
      '11h 30m window',
    ]);
  });

  it('turns amber for an early start that still kept inside the length', () => {
    expect(windowVerdict(ate('08:00', '17:00'))).toEqual({
      tone: 'warn',
      reasons: ['ate before 9am'],
    });
  });

  it('turns red for an early start that stretched the day out', () => {
    expect(windowVerdict(ate('07:00', '18:00')).tone).toBe('over'); // 11 hours
  });

  it('reads a single late entry as amber, not as an over-long window', () => {
    // One bite at 8pm has no span to speak of, and spanMinutes is null there.
    expect(windowVerdict(ate('20:00', '20:00')).tone).toBe('warn');
  });

  it('measures against the target the user actually set, not a fixed ten hours', () => {
    // A 12-hour target: 11½ hours of eating is late, but not over-long.
    expect(windowVerdict(ate('10:00', '21:30', '09:00', '21:00')).tone).toBe('warn');
  });

  it('lists both ends when the day broke out of the window in both directions', () => {
    expect(windowVerdict(ate('07:30', '21:00')).reasons).toEqual([
      'ate before 9am',
      'ate after 7pm',
      '13h 30m window',
    ]);
  });
});
