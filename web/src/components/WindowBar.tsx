import type { DaySummary } from '../types';

const DAY_START = 5 * 60; // 05:00 — the bar covers a waking day, not a full 24 hours
const DAY_END = 24 * 60;
const SPAN = DAY_END - DAY_START;

export type WindowTone = 'ok' | 'warn' | 'over';

/**
 * How the day stands against the eating window, and why.
 *
 * Three steps rather than two, because two flatten the difference that matters.
 * Green means "not broken yet" rather than "finished clean": a day still in
 * progress, and a day with nothing logged, are both still intact — the window can
 * only be violated by something actually eaten outside it. Amber is a day that ran
 * past an edge but still did all of its eating inside a stretch no longer than the
 * window is wide; that is the window shifted, not abandoned. Red is the failure the
 * rule exists to prevent: eating spread over more hours than the window allows at
 * all, whichever end it leaked out of.
 *
 * The threshold is the target's own length — ten hours, for 9am–7pm — rather than a
 * literal ten, so it goes on meaning the same thing if the window is ever retargeted.
 */
export function windowVerdict(w: DaySummary['window']): { tone: WindowTone; reasons: string[] } {
  const reasons = [
    w.startedOnTime === false && `ate before ${clock(w.target_start)}`,
    w.endedOnTime === false && `ate after ${clock(w.target_end)}`,
  ].filter(Boolean) as string[];

  // Measured off the two ends rather than read from spanMinutes, which is null on a
  // day with a single entry — that day has a span, it is just zero.
  const span = w.first !== null && w.last !== null ? toMinutes(w.last) - toMinutes(w.first) : 0;
  const target = toMinutes(w.target_end) - toMinutes(w.target_start);

  // Outrunning the target's length is impossible without leaving it at one end, so
  // the red case always has a violation to name alongside the length.
  if (span > target) return { tone: 'over', reasons: [...reasons, `${formatSpan(span)} window`] };

  return { tone: reasons.length > 0 ? 'warn' : 'ok', reasons };
}

/**
 * The day's actual eating window against the 9am–7pm target, drawn to scale.
 *
 * This is derived from the first and last food log entries rather than self-reported,
 * so it shows what happened rather than what was intended.
 */
export function WindowBar({ window: w }: { window: DaySummary['window'] }) {
  const targetStart = toMinutes(w.target_start);
  const targetEnd = toMinutes(w.target_end);

  // One line carrying both the goal and how the day is going against it.
  const { tone, reasons } = windowVerdict(w);
  const intact = tone === 'ok';

  const rule = (
    <div className={`win-rule win-rule-${tone}`}>
      <span aria-hidden="true">{intact ? '✓' : '✗'}</span> Eating window {clock(w.target_start)}–
      {clock(w.target_end)}
      {!intact && <span className="win-rule-reason"> · {reasons.join(', ')}</span>}
    </div>
  );

  const logged = w.first !== null && w.last !== null;
  const first = logged ? toMinutes(w.first!) : 0;
  const last = logged ? toMinutes(w.last!) : 0;

  return (
    <div className="win">
      <div className="win-track">
        <div className="win-target" style={barStyle(targetStart, targetEnd)} />
        {logged && (
          <div
            className={`win-actual ${intact ? 'win-ok' : 'win-bad'}`}
            style={barStyle(first, Math.max(last, first + 6))}
          />
        )}
      </div>

      <div className="win-labels">
        {logged ? (
          <>
            <span className={w.startedOnTime ? '' : 'win-late'}>
              {w.first}
              <span className="faint tiny"> first</span>
            </span>
            <span className="faint tiny">
              {w.spanMinutes !== null ? `${formatSpan(w.spanMinutes)} window` : 'one entry'}
            </span>
            <span className={w.endedOnTime ? '' : 'win-late'}>
              {w.last}
              <span className="faint tiny"> last</span>
            </span>
          </>
        ) : (
          <span className="faint tiny">Nothing logged yet</span>
        )}
      </div>

      {rule}
    </div>
  );
}

function barStyle(fromMin: number, toMin: number) {
  const clamp = (m: number) => Math.max(0, Math.min(SPAN, m - DAY_START));
  const left = (clamp(fromMin) / SPAN) * 100;
  const width = ((clamp(toMin) - clamp(fromMin)) / SPAN) * 100;
  return { left: `${left}%`, width: `${width}%` };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatSpan(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** 24-hour HH:MM to a readable 12-hour clock: 19:00 becomes 7pm. */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}
