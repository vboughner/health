import type { DaySummary } from '../types';

const DAY_START = 5 * 60; // 05:00 — the bar covers a waking day, not a full 24 hours
const DAY_END = 24 * 60;
const SPAN = DAY_END - DAY_START;

/**
 * The day's actual eating window against the 9am–7pm target, drawn to scale.
 *
 * This is derived from the first and last food log entries rather than self-reported,
 * so it shows what happened rather than what was intended.
 */
export function WindowBar({ window: w }: { window: DaySummary['window'] }) {
  const targetStart = toMinutes(w.target_start);
  const targetEnd = toMinutes(w.target_end);

  // The rule, stated plainly and always on screen — the whole point of the window
  // is the hard stop at the end of it, and it should not take a violation to see it.
  const rule = (
    <div className="win-rule">
      Finish eating by <strong>{clock(w.target_end)}</strong>
      <span className="faint">
        {' '}
        · window {clock(w.target_start)}–{clock(w.target_end)}
      </span>
    </div>
  );

  if (w.first === null || w.last === null) {
    return (
      <div className="win">
        <div className="win-track">
          <div className="win-target" style={barStyle(targetStart, targetEnd)} />
        </div>
        <div className="win-labels">
          <span className="faint tiny">Nothing logged yet</span>
        </div>
        {rule}
      </div>
    );
  }

  const first = toMinutes(w.first);
  const last = toMinutes(w.last);
  const state = w.compliant ? 'ok' : 'bad';

  return (
    <div className="win">
      <div className="win-track">
        <div className="win-target" style={barStyle(targetStart, targetEnd)} />
        <div
          className={`win-actual win-${state}`}
          style={barStyle(first, Math.max(last, first + 6))}
        />
      </div>

      <div className="win-labels">
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
      </div>

      {w.compliant ? (
        <div className="win-verdict win-verdict-ok">
          <span aria-hidden="true">✓</span> Ate inside the window
        </div>
      ) : (
        <div className="win-verdict win-verdict-bad">
          <span aria-hidden="true">✗</span>{' '}
          {[
            !w.startedOnTime && `started before ${clock(w.target_start)}`,
            !w.endedOnTime && `ate after ${clock(w.target_end)}`,
          ]
            .filter(Boolean)
            .join(', ')}
        </div>
      )}

      {rule}
    </div>
  );
}

/** 24-hour HH:MM to a readable 12-hour clock: 19:00 becomes 7pm. */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
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
