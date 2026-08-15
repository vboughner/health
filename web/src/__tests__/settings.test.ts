import { describe, it, expect, beforeEach } from 'vitest';
import {
  readSettings,
  writeSettings,
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

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('has everything on before anything has been chosen', () => {
    expect(readSettings()).toEqual(ALL_ON);
    expect(DEFAULT_SETTINGS).toEqual(ALL_ON);
  });

  it('remembers a feature being turned off', () => {
    writeSettings({ ...ALL_ON, exercise: false });
    expect(readSettings().exercise).toBe(false);
  });

  it('remembers it being turned back on', () => {
    writeSettings({ ...ALL_ON, exercise: false });
    writeSettings(ALL_ON);
    expect(readSettings().exercise).toBe(true);
  });

  it('falls back to everything on rather than dropping a screen on bad JSON', () => {
    localStorage.setItem('health:settings', '{not json');
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores a stored value that is not an object at all', () => {
    localStorage.setItem('health:settings', '"exercise"');
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in a feature a stored blob has never heard of', () => {
    // Written by a build that predates the weight toggle. The unknown key defaults
    // on, so an upgrade shows the new section rather than silently hiding it.
    localStorage.setItem(
      'health:settings',
      JSON.stringify({ food: false, exercise: true, sleep: true }),
    );

    expect(readSettings()).toEqual({ ...ALL_ON, food: false });
  });

  it('keeps a key it does not recognise from leaking into the result', () => {
    localStorage.setItem('health:settings', JSON.stringify({ ...ALL_ON, mood: false }));

    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('treats anything other than an explicit false as on', () => {
    // Only a real "off" turns something off — a null or a stray string is not a
    // considered choice, and guessing off would hide a section nobody asked to hide.
    localStorage.setItem('health:settings', JSON.stringify({ food: null, exercise: 'no' }));

    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
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
    // One survivor is enough to keep the day screen worth drawing, whichever it is.
    expect(nothingTracked({ ...ALL_OFF, [key]: true })).toBe(false);
  });

  it('counts every feature the settings screen offers', () => {
    // Guards the shortcut in nothingTracked: it asks FEATURES rather than a list of
    // its own, so a toggle added later must not be able to slip past it.
    expect(FEATURES.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
