import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearLegacySettings,
  nothingTracked,
  DEFAULT_SETTINGS,
  FEATURES,
  isOn,
  depth,
  type Settings,
} from '../settings';

const ALL_ON: Settings = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
  macros: true,
  protein: true,
};

describe('clearLegacySettings', () => {
  beforeEach(() => localStorage.clear());

  it('removes the per-device toggles this app used to keep', () => {
    // They are not adopted: the server's defaults win, once. Deleting the key stops
    // an old value reappearing if this ever reads localStorage again.
    localStorage.setItem('health:settings', JSON.stringify({ exercise: false }));
    clearLegacySettings();
    expect(localStorage.getItem('health:settings')).toBeNull();
  });

  it('is fine when there is nothing to remove', () => {
    expect(() => clearLegacySettings()).not.toThrow();
  });
});

describe('nothingTracked', () => {
  const ALL_OFF = Object.fromEntries(FEATURES.map((f) => [f.key, false])) as unknown as Settings;

  it('is false with everything on', () => {
    expect(nothingTracked(ALL_ON)).toBe(false);
  });

  it('is true only once the last feature goes off', () => {
    expect(nothingTracked(ALL_OFF)).toBe(true);
  });

  it.each(FEATURES.filter((f) => !f.parent).map((f) => f.key))(
    'stays false while %s is still on',
    (key) => {
      expect(nothingTracked({ ...ALL_OFF, [key]: true })).toBe(false);
    },
  );

  it('counts every feature the settings screen offers', () => {
    // Guards the shortcut in nothingTracked: it asks FEATURES rather than a list of
    // its own, so a toggle added later must not be able to slip past it. This matters
    // more now, not less — the keys are columns, and the server has its own list.
    expect(FEATURES.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('ignores sub-toggles: Macros on under Diet off draws nothing', () => {
    const onlyChildren = {
      ...ALL_ON,
      food: false,
      exercise: false,
      sleep: false,
      weight: false,
      goals: false,
    };
    expect(nothingTracked(onlyChildren)).toBe(true);
  });
});

describe('isOn', () => {
  it("is a top-level feature's own value", () => {
    expect(isOn({ ...ALL_ON, sleep: false }, 'sleep')).toBe(false);
    expect(isOn(ALL_ON, 'sleep')).toBe(true);
  });

  it('is off when any ancestor is off, whatever the child says', () => {
    expect(isOn({ ...ALL_ON, food: false }, 'macros')).toBe(false);
    expect(isOn({ ...ALL_ON, food: false }, 'protein')).toBe(false);
    expect(isOn({ ...ALL_ON, macros: false }, 'protein')).toBe(false);
  });

  it('comes back as it was when the ancestor comes back', () => {
    const s = { ...ALL_ON, protein: false };
    expect(isOn({ ...s, food: false }, 'protein')).toBe(false);
    expect(isOn(s, 'protein')).toBe(false);
    expect(isOn(s, 'macros')).toBe(true);
  });
});

describe('FEATURES nesting', () => {
  it('lists Macros under Diet and Protein target under Macros, each right after its parent', () => {
    const keys = FEATURES.map((f) => f.key);
    expect(FEATURES.find((f) => f.key === 'macros')?.parent).toBe('food');
    expect(FEATURES.find((f) => f.key === 'protein')?.parent).toBe('macros');
    expect(keys.indexOf('macros')).toBe(keys.indexOf('food') + 1);
    expect(keys.indexOf('protein')).toBe(keys.indexOf('macros') + 1);
    expect(depth('food')).toBe(0);
    expect(depth('protein')).toBe(2);
  });
});
