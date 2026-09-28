import { describe, it, expect } from 'vitest';
import { stepPath, weekCellText, weekLabel } from '../components/charts';

/** A geometry stub: x is the index times ten, y is the value negated. */
const geom = {
  x: (i: number) => i * 10,
  y: (v: number) => -v,
};

/** Every distinct height the path visits, in the order-free sense that matters here. */
function heightsIn(path: string): Set<string> {
  return new Set(
    path
      .split(/[ML]/)
      .map((segment) => segment.trim().split(/\s+/)[1])
      .filter(Boolean),
  );
}

/**
 * The path's anchor points in order, as [x, y] pairs. Unlike `heightsIn`, this
 * keeps each anchor's x, which is what tells a step from a slope: a diagonal from
 * (0, -3000) to (100, -2000) visits the same two heights as a step does, but only
 * a step has two anchors sharing one x with different y — the riser.
 */
function anchorsIn(path: string): [string, string][] {
  const tokens = path.trim().split(/\s+/);
  const anchors: [string, string][] = [];
  for (let i = 0; i < tokens.length; i += 3) {
    anchors.push([tokens[i + 1], tokens[i + 2]]);
  }
  return anchors;
}

describe('stepPath', () => {
  it('stays at one height when the budget never changes', () => {
    const d = stepPath([{ budget: 2400 }, { budget: 2400 }, { budget: 2400 }], geom, 0, 100);
    expect(heightsIn(d)).toEqual(new Set(['-2400']));
  });

  it('places the riser at the midpoint between differing days', () => {
    // The change happens at one x rather than sloping across the gap — the budget
    // was one number and then another, never anything in between. Pinning the full
    // anchor sequence (not just which heights appear) is what catches a regression
    // to a plain diagonal: that would visit the same two heights but never produce
    // two anchors at the same x.
    const d = stepPath([{ budget: 3000 }, { budget: 2000 }], geom, 0, 100);
    expect(anchorsIn(d)).toEqual([
      ['0', '-3000'],
      ['5', '-3000'],
      ['5', '-2000'],
      ['100', '-2000'],
    ]);
  });

  it('spans the full plot width', () => {
    const d = stepPath([{ budget: 2400 }, { budget: 2400 }], geom, 5, 95);
    expect(d.startsWith('M 5 ')).toBe(true);
    expect(d.trimEnd().endsWith('95 -2400')).toBe(true);
  });
});

describe('weekCellText', () => {
  it('ticks a met week', () => {
    expect(weekCellText({ count: 2, state: 'met' })).toBe('2 ✓');
  });

  it('marks the current week as still going, never as a miss', () => {
    expect(weekCellText({ count: 1, state: 'in_progress' })).toBe('1…');
  });

  it('shows a bare count otherwise', () => {
    expect(weekCellText({ count: 1, state: 'missed' })).toBe('1');
    expect(weekCellText({ count: 0, state: 'partial' })).toBe('0');
    expect(weekCellText({ count: 3, state: 'no_target' })).toBe('3');
  });

  it('shows nothing for a week with no record at all', () => {
    expect(weekCellText({ count: 0, state: 'no_record' })).toBe('');
  });
});

describe('weekLabel', () => {
  it('names a met week', () => {
    expect(weekLabel({ target: 2, state: 'met' })).toBe('met');
  });

  it('names a missed week by how far short it fell', () => {
    expect(weekLabel({ target: 2, state: 'missed' })).toBe('short of 2');
  });

  it('names the current week as still going', () => {
    expect(weekLabel({ target: 2, state: 'in_progress' })).toBe('this week');
  });

  it('names a first week cut short by the range', () => {
    expect(weekLabel({ target: 2, state: 'partial' })).toBe('partial week');
  });

  it('names a week with no target', () => {
    expect(weekLabel({ target: null, state: 'no_target' })).toBe('no target');
  });

  it('names a week with nothing recorded', () => {
    expect(weekLabel({ target: null, state: 'no_record' })).toBe('not logged');
  });
});
