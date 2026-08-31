/**
 * Client-side mirror of the server's burn arithmetic, used only for the live preview
 * while correcting a workout. The server recomputes on save — this never decides what
 * gets stored.
 *
 * MET values come from the activities the server already sent, so there is no second
 * copy of the table here to drift out of step with `domain/exercise.ts`.
 */
import type { Activity } from './types';

/**
 * What an entry's calories become at a different activity or duration.
 *
 * Scales the entry's own snapshot rather than re-estimating, exactly as the server
 * does: the estimate is proportional to body weight, so re-deriving it would price a
 * months-old workout at what you weigh now. Null whenever there is nothing honest to
 * show — a duration that is not yet a positive number, an entry with no figure to
 * scale from, or an activity the server did not send a MET for.
 */
export function burnPreview(
  entry: { activity: string; minutes: number; kcal: number },
  activity: string,
  minutes: number,
  activities: Activity[],
): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (!(entry.minutes > 0) || !(entry.kcal > 0)) return null;

  const from = activities.find((a) => a.id === entry.activity);
  const to = activities.find((a) => a.id === activity);
  if (!from || !to || !(from.met > 0)) return null;

  return Math.round(entry.kcal * (to.met / from.met) * (minutes / entry.minutes));
}
