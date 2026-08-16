import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearLegacySettings,
  nothingTracked,
  DEFAULT_SETTINGS,
  FEATURES,
  type Settings,
} from '../settings';

const ALL_ON: Settings = {
  food: true,
  exercise: true,
  sleep: true,
  weight: true,
  goals: true,
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

  it.each(FEATURES.map((f) => f.key))('stays false while %s is still on', (key) => {
    expect(nothingTracked({ ...ALL_OFF, [key]: true })).toBe(false);
  });

  it('counts every feature the settings screen offers', () => {
    // Guards the shortcut in nothingTracked: it asks FEATURES rather than a list of
    // its own, so a toggle added later must not be able to slip past it. This matters
    // more now, not less — the keys are columns, and the server has its own list.
    expect(FEATURES.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
