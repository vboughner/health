/**
 * The plan, for reading rather than editing.
 *
 * Taken verbatim from "The Plan" in Personal/Mid-2026 Goals.md. It lives here as
 * static content on purpose: the vault note stays the source of truth for the
 * goals, this is just a copy that's readable at arm's length on a phone. When the
 * note changes, this changes with it.
 */

import { useState, useEffect } from 'react';
import { api } from '../api';
import { shortDayLabel } from '../dates';

interface Section {
  title: string;
  points: string[];
}

const PLAN: Section[] = [
  {
    title: 'Calories',
    points: [
      'Limit intake to about 2400 calories/day.',
      'Exercise enough to burn ~40% of that in calories (~960 cal/day from exercise).',
    ],
  },
  {
    title: 'Eating window',
    points: ['Only eat between 9:00 a.m. and 7:00 p.m.'],
  },
  {
    title: 'Diet',
    points: [
      'Natural, whole foods — real foods as close as possible to how they are found in nature.',
      'Gold standard reference: the 80/10/10 diet (mostly raw fruits and vegetables). Not going full raw, but it is the north star.',
      'Allowances beyond raw: cooked grains like brown rice, steamed vegetables, and other relatively harmless cooked whole foods.',
      'Lots of fruits and vegetables.',
      'No dairy, no meat. Not going to sweat something like chicken broth in a veggie burrito — just no actual meat.',
      'Grains okay (e.g. brown rice), but not much bread.',
      'Avoid refined white flour, refined salt, refined sugar, and other highly processed ingredients.',
    ],
  },
  {
    title: 'Environment / logistics',
    points: [
      'Do not keep anything in the kitchen that I do not want to eat.',
      'Prepare ahead for what I will eat when I go out for a drive with my mother.',
    ],
  },
  {
    title: 'Exercise',
    points: [
      'Increase overall exercise to hit the 40%-of-calories target above.',
      'Keep up climbing twice a week.',
      'Keep up running three times a week.',
      'Add one weight workout a week.',
    ],
  },
];

export function Goals({
  date,
  today,
  trackReview,
  onReviewed,
}: {
  date: string;
  today: string;
  /**
   * Whether reviews are being recorded at all. With goal tracking off the plan is
   * still here to read — it is the recording that goes, not the reading.
   */
  trackReview: boolean;
  /** Called once the review is on record, so the day screen picks up the tick. */
  onReviewed: () => void;
}) {
  const [error, setError] = useState('');

  /**
   * Opening the page is the review. There is nothing to press: a button that only
   * confirms what you did by arriving is a step that can be forgotten, and what the
   * flag records is having read the plan, not having agreed to anything.
   *
   * Nothing here branches on whether the day was already reviewed, so there is
   * nothing to fetch — coming back a second time just rewrites the same true.
   */
  useEffect(() => {
    if (!trackReview) return;
    let cancelled = false;

    api
      .put(`/day/${date}`, { goals_reviewed: true })
      .then(() => {
        if (!cancelled) onReviewed();
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not record that');
      });

    return () => {
      cancelled = true;
    };
  }, [date, trackReview, onReviewed]);

  return (
    <div className="stack">
      <h1 className="screen-title">The plan</h1>

      {PLAN.map((section) => (
        <div className="card" key={section.title}>
          <div className="card-title">{section.title}</div>
          <ul className="plan-list">
            {section.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ))}

      {error && <div className="error">{error}</div>}

      {/* Past tense: by the time this is on screen the write has already gone. It
          is worth saying, because the day being marked is the one the rest of the
          app is pointed at rather than the one you are living. */}
      {trackReview && date !== today && (
        <div className="note tiny">
          Marked <strong>{shortDayLabel(date, today)}</strong> as reviewed, not today.
        </div>
      )}
    </div>
  );
}
