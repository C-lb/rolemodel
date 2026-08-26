const WIDTH = 120;
const HEIGHT = 28;
const PADDING = 3;

export interface SparkPoint {
  x: number;
  y: number;
}

/**
 * The runs of consecutive valued periods, in view coordinates.
 *
 * A gap breaks the line rather than joining across it: a stroke drawn through a period
 * that never computed is a trend the numbers do not support. A run of one point is
 * dropped, because a line needs two.
 */
export function sparklineSegments(values: (number | null)[]): SparkPoint[][] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return [];

  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min;

  const stepX = values.length > 1 ? (WIDTH - PADDING * 2) / (values.length - 1) : 0;

  const segments: SparkPoint[][] = [];
  let run: SparkPoint[] = [];

  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 1) segments.push(run);
      run = [];
      return;
    }
    // A flat series has no span to scale against, so it sits on the mid-line rather
    // than dividing by zero.
    const ratio = span === 0 ? 0.5 : (value - min) / span;
    run.push({
      x: PADDING + index * stepX,
      y: HEIGHT - PADDING - ratio * (HEIGHT - PADDING * 2),
    });
  });

  if (run.length > 1) segments.push(run);
  return segments;
}

interface Props {
  /** Oldest first, so the line reads left to right the way a trend is read. */
  values: (number | null)[];
  label: string;
}

/**
 * A 120x28 trend line, hand-drawn in SVG. The per-period figures sit in the row beneath
 * it, so this carries no axis, no labels and no accessible text: it is decoration over
 * numbers the reader already has.
 */
export function Sparkline({ values, label }: Props) {
  const segments = sparklineSegments(values);
  if (segments.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      role="presentation"
      data-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      fill="none"
      className="h-7 w-[7.5rem] shrink-0 text-neutral-500"
    >
      {segments.map((segment, index) => (
        <polyline
          key={index}
          points={segment.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
