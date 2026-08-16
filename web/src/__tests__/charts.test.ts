import { describe, it, expect } from 'vitest';
import { stepPath } from '../components/charts';

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

describe('stepPath', () => {
  it('stays at one height when the budget never changes', () => {
    const d = stepPath([{ budget: 2400 }, { budget: 2400 }, { budget: 2400 }], geom, 0, 100);
    expect(heightsIn(d)).toEqual(new Set(['-2400']));
  });

  it('visits both heights when the budget changes', () => {
    // The change happens at one x rather than sloping across the gap — the budget
    // was one number and then another, never anything in between.
    const d = stepPath([{ budget: 3000 }, { budget: 2000 }], geom, 0, 100);
    expect(heightsIn(d)).toEqual(new Set(['-3000', '-2000']));
  });

  it('spans the full plot width', () => {
    const d = stepPath([{ budget: 2400 }, { budget: 2400 }], geom, 5, 95);
    expect(d.startsWith('M 5 ')).toBe(true);
    expect(d.trimEnd().endsWith('95 -2400')).toBe(true);
  });
});
