import { describe, it, expect } from 'vitest';
import { isStaleMediaError } from '../components/GoalsPlayer';

describe('isStaleMediaError', () => {
  it('is stale when idle and nothing has started since the cancel that made it idle', () => {
    expect(
      isStaleMediaError({ loading: false, playing: false, attempt: 1, cancelledAttempt: 1 }),
    ).toBe(true);
  });

  it('is not stale on a fresh mount, before any cancel has ever happened', () => {
    expect(
      isStaleMediaError({ loading: false, playing: false, attempt: 0, cancelledAttempt: -1 }),
    ).toBe(false);
  });

  it('is not stale while a newer attempt is loading, even one riding on a cancelled load', () => {
    // Only one network fetch is ever in flight per mount (no load()/src change happens
    // while mounted), so an error surfacing here is this attempt's own, not a stale one.
    expect(
      isStaleMediaError({ loading: true, playing: false, attempt: 2, cancelledAttempt: 1 }),
    ).toBe(false);
  });

  it('is not stale while a newer attempt is playing', () => {
    expect(
      isStaleMediaError({ loading: false, playing: true, attempt: 2, cancelledAttempt: 1 }),
    ).toBe(false);
  });

  it('is not stale for a genuine error with no cancel in its history', () => {
    expect(
      isStaleMediaError({ loading: false, playing: true, attempt: 1, cancelledAttempt: -1 }),
    ).toBe(false);
  });

  it('is stale again after a second attempt is itself cancelled', () => {
    expect(
      isStaleMediaError({ loading: false, playing: false, attempt: 2, cancelledAttempt: 2 }),
    ).toBe(true);
  });
});
