import { describe, it, expect } from 'vitest';
import {
  todayIn,
  addDays,
  daysBetween,
  dayLabel,
  shortDayLabel,
  atTimeOn,
  nowTime,
} from '../dates';

const LA = 'America/Los_Angeles';

describe('todayIn', () => {
  it('reports the local date, not the UTC one', () => {
    // 8pm Pacific is already the next day in UTC.
    const evening = Date.parse('2026-01-15T20:00:00-08:00');

    expect(todayIn(LA, evening)).toBe('2026-01-15');
    expect(todayIn('UTC', evening)).toBe('2026-01-16');
  });

  it('zero-pads', () => {
    expect(todayIn(LA, Date.parse('2026-01-05T12:00:00-08:00'))).toBe('2026-01-05');
  });
});

describe('addDays', () => {
  it('steps forward and back', () => {
    expect(addDays('2026-08-10', -1)).toBe('2026-08-09');
    expect(addDays('2026-08-10', 1)).toBe('2026-08-11');
    expect(addDays('2026-08-10', 0)).toBe('2026-08-10');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('is not thrown off by a DST change', () => {
    // Clocks jumped forward at 2am on 2026-03-08.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-03-09', -1)).toBe('2026-03-08');
  });

  it('round-trips over a long span', () => {
    expect(addDays(addDays('2026-08-10', -90), 90)).toBe('2026-08-10');
  });
});

describe('daysBetween', () => {
  it('is negative going back in time', () => {
    expect(daysBetween('2026-08-10', '2026-08-09')).toBe(-1);
    expect(daysBetween('2026-08-10', '2026-08-11')).toBe(1);
    expect(daysBetween('2026-08-10', '2026-08-10')).toBe(0);
  });

  it('counts across a DST change correctly', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('dayLabel', () => {
  const today = '2026-08-10'; // a Monday

  it('names today and its neighbours', () => {
    expect(dayLabel('2026-08-10', today)).toBe('Today');
    expect(dayLabel('2026-08-09', today)).toBe('Yesterday');
    expect(dayLabel('2026-08-11', today)).toBe('Tomorrow');
  });

  it('uses the weekday inside the past week', () => {
    expect(dayLabel('2026-08-07', today)).toBe('Friday');
    expect(dayLabel('2026-08-05', today)).toBe('Wednesday');
  });

  it('falls back to a date beyond a week', () => {
    const label = dayLabel('2026-07-20', today);
    expect(label).toMatch(/Jul/);
    expect(label).toMatch(/20/);
  });

  it('shows the year only when it differs from today', () => {
    expect(dayLabel('2026-02-10', today)).not.toMatch(/2026/);
    expect(dayLabel('2025-11-10', today)).toMatch(/2025/);
  });

  it('does not call a day seven back by its weekday, which would be ambiguous', () => {
    // Exactly a week ago is also a Monday — "Monday" would read as today.
    expect(dayLabel('2026-08-03', today)).not.toBe('Monday');
  });
});

describe('shortDayLabel', () => {
  const today = '2026-08-10';

  it('reads naturally in a sentence', () => {
    expect(shortDayLabel('2026-08-10', today)).toBe('today');
    expect(shortDayLabel('2026-08-09', today)).toBe('yesterday');
    expect(shortDayLabel('2026-08-01', today)).toMatch(/Aug/);
  });
});

describe('atTimeOn', () => {
  it('lands on the right day at the right wall-clock time', () => {
    const ms = atTimeOn('2026-08-09', '13:45');
    const d = new Date(ms);

    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(45);
  });

  it('handles midnight and the last minute of the day', () => {
    expect(new Date(atTimeOn('2026-08-09', '00:00')).getHours()).toBe(0);
    expect(new Date(atTimeOn('2026-08-09', '23:59')).getDate()).toBe(9);
  });
});

describe('nowTime', () => {
  it('formats as zero-padded HH:MM', () => {
    expect(nowTime(new Date(2026, 7, 10, 9, 5))).toBe('09:05');
    expect(nowTime(new Date(2026, 7, 10, 19, 30))).toBe('19:30');
    expect(nowTime(new Date(2026, 7, 10, 0, 0))).toBe('00:00');
  });
});
