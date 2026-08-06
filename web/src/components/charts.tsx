import { useRef, useState, useEffect, useMemo, type ReactNode } from 'react';

export interface Series {
  day: string;
  value: number | null;
}

const PAD = { top: 10, right: 6, bottom: 18, left: 36 };
const HEIGHT = 148;

/** Measure the container so the chart draws in real pixels — no viewBox scaling. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** Shared frame: measures, renders a tooltip, and tracks the hovered index. */
function ChartFrame({
  points,
  scale,
  children,
  tooltip,
}: {
  points: Series[];
  scale?: Scale;
  children: (geom: Geometry) => ReactNode;
  tooltip: (index: number) => ReactNode;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const scaleKey = JSON.stringify(scale ?? {});
  const geom = useMemo(
    () => geometry(points, width, JSON.parse(scaleKey)),
    [points, width, scaleKey],
  );

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHover(geom.indexAt(x));
  }

  return (
    <div className="chart" ref={ref}>
      {width > 0 && geom && (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {geom.gridLines.map((g) => (
              <g key={g.value}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={g.y}
                  y2={g.y}
                  className="chart-grid"
                />
                <text x={PAD.left - 6} y={g.y + 3.5} className="chart-tick" textAnchor="end">
                  {g.label}
                </text>
              </g>
            ))}

            {children(geom)}

            {hover !== null && (
              <line
                x1={geom.x(hover)}
                x2={geom.x(hover)}
                y1={PAD.top}
                y2={HEIGHT - PAD.bottom}
                className="chart-crosshair"
              />
            )}

            <text x={PAD.left} y={HEIGHT - 5} className="chart-tick">
              {shortDay(points[0].day)}
            </text>
            <text x={width - PAD.right} y={HEIGHT - 5} className="chart-tick" textAnchor="end">
              {shortDay(points[points.length - 1].day)}
            </text>
          </svg>

          {hover !== null && (
            <div
              className="chart-tip"
              style={{ left: Math.min(Math.max(geom.x(hover), 48), width - 48) }}
            >
              {tooltip(hover)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Weight over time: raw readings as dots, the smoothed line through them as the
 * actual trend. One series, so no legend — the card title names it.
 */
export function WeightChart({ points, smoothed }: { points: Series[]; smoothed: Series[] }) {
  if (points.filter((p) => p.value !== null).length < 2) {
    return <div className="empty tiny">Weigh in on a few more days to see a trend.</div>;
  }

  const smoothMap = new Map(smoothed.map((s) => [s.day, s.value]));

  return (
    <ChartFrame
      points={points}
      tooltip={(i) => (
        <>
          <div className="chart-tip-day">{longDay(points[i].day)}</div>
          <div className="chart-tip-value">
            {points[i].value === null ? 'not weighed' : `${points[i].value} lb`}
          </div>
        </>
      )}
    >
      {(geom) => (
        <>
          <path
            d={geom.linePath(
              points.map((p) => smoothMap.get(p.day) ?? null),
              true,
            )}
            className="chart-line"
          />
          {points.map((p, i) =>
            p.value === null ? null : (
              <circle
                key={p.day}
                cx={geom.x(i)}
                cy={geom.y(p.value)}
                r={3.5}
                className="chart-dot"
              />
            ),
          )}
        </>
      )}
    </ChartFrame>
  );
}

/**
 * Daily calories against the budget. Position already says whether a bar cleared
 * the reference line; the color reinforces it rather than carrying it alone.
 */
export function CalorieChart({ points, budget }: { points: Series[]; budget: number }) {
  if (points.every((p) => p.value === null)) {
    return <div className="empty tiny">Nothing logged in this range yet.</div>;
  }

  return (
    <ChartFrame
      points={points}
      // Zero baseline, and the axis must reach the budget line even on a week
      // where every day came in under it.
      scale={{ fromZero: true, include: [budget] }}
      tooltip={(i) => (
        <>
          <div className="chart-tip-day">{longDay(points[i].day)}</div>
          <div className="chart-tip-value">
            {points[i].value === null ? 'nothing logged' : `${points[i].value} cal`}
          </div>
        </>
      )}
    >
      {(geom) => (
        <>
          <line
            x1={PAD.left}
            x2={geom.width - PAD.right}
            y1={geom.y(budget)}
            y2={geom.y(budget)}
            className="chart-ref"
          />
          {points.map((p, i) => {
            if (p.value === null) return null;
            const top = geom.y(p.value);
            const base = geom.baseline;
            return (
              <rect
                key={p.day}
                x={geom.x(i) - geom.barWidth / 2}
                y={top}
                width={geom.barWidth}
                height={Math.max(2, base - top)}
                rx={Math.min(4, geom.barWidth / 2)}
                className={p.value > budget ? 'chart-bar chart-bar-over' : 'chart-bar'}
              />
            );
          })}
        </>
      )}
    </ChartFrame>
  );
}

/**
 * One cell per day: inside the window, outside it, or nothing logged.
 * Legend included — state must never be carried by color alone.
 */
export function ComplianceStrip({ days }: { days: { day: string; ok: boolean | null }[] }) {
  return (
    <div className="strip-wrap">
      <div className="strip">
        {days.map((d) => (
          <div
            key={d.day}
            className={`strip-cell ${d.ok === null ? 'strip-none' : d.ok ? 'strip-ok' : 'strip-bad'}`}
            title={`${longDay(d.day)} — ${d.ok === null ? 'nothing logged' : d.ok ? 'within window' : 'outside window'}`}
          />
        ))}
      </div>
      <div className="strip-legend">
        <LegendItem cls="strip-ok" label="Within" />
        <LegendItem cls="strip-bad" label="Outside" />
        <LegendItem cls="strip-none" label="Not logged" />
      </div>
    </div>
  );
}

function LegendItem({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="strip-legend-item">
      <span className={`strip-swatch ${cls}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- geometry

interface Geometry {
  width: number;
  barWidth: number;
  baseline: number;
  x: (index: number) => number;
  y: (value: number) => number;
  indexAt: (px: number) => number;
  linePath: (values: (number | null)[], connectGaps?: boolean) => string;
  gridLines: { value: number; y: number; label: string }[];
}

export interface Scale {
  /**
   * Bars must start at zero — a truncated baseline makes a 1200-calorie day look
   * a fraction of a 2000-calorie one. Lines get a padded band around the data,
   * because a weight axis from zero would flatten the whole trend into a line.
   */
  fromZero?: boolean;
  /** Extra values the axis must cover, e.g. a reference line above every bar. */
  include?: number[];
}

function geometry(points: Series[], width: number, scale: Scale = {}): Geometry | null {
  if (width <= 0 || points.length === 0) return null;

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const covered = [...values, ...(scale.include ?? [])];
  let min = covered.length ? Math.min(...covered) : 0;
  let max = covered.length ? Math.max(...covered) : 1;

  if (scale.fromZero) {
    min = 0;
    max = max * 1.08;
    if (max === 0) max = 1;
  } else {
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const padding = (max - min) * 0.12;
    min -= padding;
    max += padding;
  }

  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const x = (i: number) => PAD.left + (points.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  // A 2px surface gap between adjacent bars, per the mark spec.
  const barWidth = Math.max(2, Math.min(22, plotW / points.length - 2));

  return {
    width,
    barWidth,
    baseline: y(scale.fromZero ? 0 : min),
    x,
    y,
    indexAt: (px) => {
      if (points.length === 1) return 0;
      const i = Math.round((px - PAD.left) / step);
      return Math.max(0, Math.min(points.length - 1, i));
    },
    linePath: (vals, connectGaps = false) => {
      let d = '';
      let pen = false;
      vals.forEach((v, i) => {
        if (v === null) {
          // A trend line through occasional weigh-ins should stay continuous;
          // a series with real gaps in the data should break.
          if (!connectGaps) pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    },
    gridLines: [max, (max + min) / 2, min].map((v) => ({
      value: v,
      y: y(v),
      label: formatTick(v),
    })),
  };
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v * 10) / 10);
}

function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
