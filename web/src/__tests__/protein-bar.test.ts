import { describe, it, expect } from 'vitest';
import { proteinBar } from '../components/ProteinBar';

const day = (grams: number, floor = false) => ({ grams, min: 90, max: 130, floor });

describe('proteinBar', () => {
  it('scales so the top of the range sits at 85% of the width', () => {
    const s = proteinBar(day(0));
    expect(s.band!.left).toBeCloseTo((90 / 130) * 85);
    expect(s.band!.left + s.band!.width).toBeCloseTo(85);
  });

  it('is not in range below the minimum', () => {
    const s = proteinBar(day(72));
    expect(s.inRange).toBe(false);
    expect(s.fill).toBeCloseTo((72 / 130) * 85);
    expect(s.label).toBe('72 g');
    expect(s.target).toBe('90–130 g');
  });

  it('is in range from the minimum, inclusive', () => {
    expect(proteinBar(day(90)).inRange).toBe(true);
    expect(proteinBar(day(130)).inRange).toBe(true);
  });

  it('stays in range above the maximum — too much protein is not what this watches', () => {
    const s = proteinBar(day(150));
    expect(s.inRange).toBe(true);
  });

  it('fills to the edge and no further', () => {
    expect(proteinBar(day(400)).fill).toBe(100);
  });

  it('says the figure is a floor when some calories have no macros', () => {
    expect(proteinBar(day(72, true)).label).toBe('72+ g');
  });

  it('draws no band and makes no judgement without a range', () => {
    const s = proteinBar({ grams: 72, min: null, max: null, floor: false });
    expect(s.band).toBeNull();
    expect(s.target).toBeNull();
    expect(s.inRange).toBe(false);
  });
});
