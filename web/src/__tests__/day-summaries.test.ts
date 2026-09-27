import { describe, it, expect } from 'vitest';
import {
  calorieSummary,
  morningSummary,
  bedtimeSummary,
  macrosWindowSummary,
} from '../screens/Today';
import type { Settings } from '../settings';

const TZ = 'America/Los_Angeles';
const at = (hhmm: string) => Date.parse(`2026-01-15T${hhmm}:00-08:00`);

const all: Settings = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
  macros: true,
  protein: true,
};

const blankDay = {
  weight_lb: null,
  sleep_start: null,
  sleep_end: null,
  goals_reviewed: false,
};

describe('calorieSummary', () => {
  it('names what is left of today', () => {
    expect(calorieSummary(1391, 2400, true)).toEqual({ text: '1009 left', over: false });
  });

  it('calls it under budget when the day is finished', () => {
    expect(calorieSummary(1391, 2400, false)).toEqual({ text: '1009 under', over: false });
  });

  it('counts up past the budget, and says so', () => {
    expect(calorieSummary(2541, 2400, true)).toEqual({ text: '+141 over', over: true });
  });

  it('is not over at exactly the budget', () => {
    expect(calorieSummary(2400, 2400, true)).toEqual({ text: '0 left', over: false });
  });
});

describe('morningSummary', () => {
  it('carries the weight and the time you got up', () => {
    expect(morningSummary({ ...blankDay, weight_lb: 192.8, sleep_end: at('06:40') }, all, TZ)).toBe(
      '192.8 lb · up 6:40 AM',
    );
  });

  it('drops the half that has not been recorded yet', () => {
    expect(morningSummary({ ...blankDay, weight_lb: 192.8 }, all, TZ)).toBe('192.8 lb');
    expect(morningSummary({ ...blankDay, sleep_end: at('06:40') }, all, TZ)).toBe('up 6:40 AM');
  });

  it('says nothing at all for an untouched morning', () => {
    expect(morningSummary(blankDay, all, TZ)).toBeUndefined();
  });

  it('leaves out what this account does not track', () => {
    const day = { ...blankDay, weight_lb: 192.8, sleep_end: at('06:40') };
    expect(morningSummary(day, { ...all, sleep: false }, TZ)).toBe('192.8 lb');
    expect(morningSummary(day, { ...all, weight: false }, TZ)).toBe('up 6:40 AM');
  });
});

describe('bedtimeSummary', () => {
  it('carries the time you went down and whether the plan was read', () => {
    expect(
      bedtimeSummary({ ...blankDay, sleep_start: at('22:15'), goals_reviewed: true }, all, TZ),
    ).toBe('down 10:15 PM · ✓ reviewed');
  });

  it('keeps the tick on its own when there is no bedtime yet', () => {
    expect(bedtimeSummary({ ...blankDay, goals_reviewed: true }, all, TZ)).toBe('✓ reviewed');
  });

  it('says nothing for an evening that has not happened', () => {
    expect(bedtimeSummary(blankDay, all, TZ)).toBeUndefined();
  });

  it('leaves out what this account does not track', () => {
    const day = { ...blankDay, sleep_start: at('22:15'), goals_reviewed: true };
    expect(bedtimeSummary(day, { ...all, goals: false }, TZ)).toBe('down 10:15 PM');
    expect(bedtimeSummary(day, { ...all, sleep: false }, TZ)).toBe('✓ reviewed');
  });
});

describe('macrosWindowSummary', () => {
  it('carries protein and the window', () => {
    expect(macrosWindowSummary({ first: '9:14', last: '6:40' }, { grams: 72, floor: false })).toBe(
      '72 g protein · 9:14–6:40',
    );
  });

  it('marks a floor', () => {
    expect(macrosWindowSummary({ first: null, last: null }, { grams: 72, floor: true })).toBe(
      '72+ g protein',
    );
  });

  it('drops protein when it is not being drawn, and says nothing for an empty day', () => {
    expect(macrosWindowSummary({ first: '9:14', last: '6:40' }, null)).toBe('9:14–6:40');
    expect(macrosWindowSummary({ first: null, last: null }, null)).toBeUndefined();
  });
});
