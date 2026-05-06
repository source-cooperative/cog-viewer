import { useCallback, useMemo, useRef, useState } from "react";
import type { BandStats } from "../render/stats";

type Props = {
  stats: BandStats;
  /** Current scrubber range. Clamped to [stats.min, stats.max] visually. */
  value: [number, number];
  onChange: (next: [number, number]) => void;
  /** CSS color for the histogram bars. RGB modes pass channel-tinted colors;
   * single-band defaults to neutral. */
  color?: string;
  height?: number;
  /** Optional label rendered above the chart (e.g. "R", "G", "B"). */
  label?: string;
};

const HANDLE_RADIUS = 6;
const HANDLE_HIT_RADIUS = 12;

/** SVG histogram with two draggable handles defining a rescale range. The
 * shaded band between the handles indicates the active region; clicking on
 * the chart snaps the nearest handle to that x value. The component is
 * controlled — the parent owns `value` and writes back via `onChange`. */
export function BandHistogram({
  stats,
  value,
  onChange,
  color = "var(--text)",
  height = 80,
  label,
}: Props) {
  const ref = useRef<SVGSVGElement | null>(null);
  // Track which handle (low/high) is being dragged. null = idle.
  const [dragging, setDragging] = useState<"lo" | "hi" | null>(null);

  const range = stats.max - stats.min;
  const safeRange = range > 0 ? range : 1;
  const maxBin = useMemo(
    () => stats.histogram.reduce((a, b) => Math.max(a, b), 0) || 1,
    [stats.histogram],
  );

  // [stats.min .. stats.max] → [0 .. 1] in chart coords.
  const toFrac = (v: number) => Math.max(0, Math.min(1, (v - stats.min) / safeRange));
  const fromFrac = (f: number) => stats.min + f * safeRange;

  const lo = Math.min(value[0], value[1]);
  const hi = Math.max(value[0], value[1]);
  const loFrac = toFrac(lo);
  const hiFrac = toFrac(hi);

  /** Convert a pointer event's clientX to the source-unit value. */
  const xToValue = useCallback(
    (clientX: number): number => {
      const svg = ref.current;
      if (!svg) return stats.min;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return stats.min;
      const fx = (clientX - rect.left) / rect.width;
      return fromFrac(Math.max(0, Math.min(1, fx)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats.min, safeRange],
  );

  const beginDrag = useCallback(
    (which: "lo" | "hi", e: React.PointerEvent<SVGElement>) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDragging(which);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging) return;
      const v = xToValue(e.clientX);
      if (dragging === "lo") {
        onChange([Math.min(v, hi), hi]);
      } else {
        onChange([lo, Math.max(v, lo)]);
      }
    },
    [dragging, hi, lo, onChange, xToValue],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging) return;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      setDragging(null);
    },
    [dragging],
  );

  /** Click on chart background → snap nearest handle. */
  const handleBackgroundDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const v = xToValue(e.clientX);
      const dLo = Math.abs(v - lo);
      const dHi = Math.abs(v - hi);
      const which: "lo" | "hi" = dLo <= dHi ? "lo" : "hi";
      if (which === "lo") onChange([Math.min(v, hi), hi]);
      else onChange([lo, Math.max(v, lo)]);
      // Continue as a drag.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setDragging(which);
    },
    [hi, lo, onChange, xToValue],
  );

  return (
    <div style={{ display: "grid", gap: 2 }}>
      {label && (
        <span
          className="field-label"
          style={{ color, fontSize: 10, letterSpacing: 0.06 }}
        >
          {label}
        </span>
      )}
      <svg
        ref={ref}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        style={{ cursor: dragging ? "grabbing" : "crosshair", touchAction: "none" }}
        onPointerDown={handleBackgroundDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <rect width="100" height={height} fill="var(--surface-muted)" />

        {/* Histogram bars */}
        {stats.histogram.map((count, i) => {
          const w = 100 / stats.histogram.length;
          const h = (count / maxBin) * (height - 4);
          return (
            <rect
              key={i}
              x={i * w}
              y={height - h}
              width={w}
              height={h}
              fill={color}
              opacity={0.55}
            />
          );
        })}

        {/* Shaded selected region */}
        <rect
          x={loFrac * 100}
          y={0}
          width={(hiFrac - loFrac) * 100}
          height={height}
          fill={color}
          opacity={0.12}
        />

        {/* Handle tracks */}
        <line
          x1={loFrac * 100}
          y1={0}
          x2={loFrac * 100}
          y2={height}
          stroke={color}
          strokeWidth={0.6}
        />
        <line
          x1={hiFrac * 100}
          y1={0}
          x2={hiFrac * 100}
          y2={height}
          stroke={color}
          strokeWidth={0.6}
        />

        {/* Handles. preserveAspectRatio=none stretches the viewBox, so we
         * place handles in viewBox coordinates with a small visual width. */}
        <Handle
          xPct={loFrac * 100}
          y={height / 2}
          color={color}
          onPointerDown={(e) => beginDrag("lo", e)}
        />
        <Handle
          xPct={hiFrac * 100}
          y={height / 2}
          color={color}
          onPointerDown={(e) => beginDrag("hi", e)}
        />
      </svg>
    </div>
  );
}

function Handle({
  xPct,
  y,
  color,
  onPointerDown,
}: {
  xPct: number;
  y: number;
  color: string;
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
}) {
  return (
    <g transform={`translate(${xPct} ${y})`}>
      {/* Larger invisible hit target, smaller visible knob. */}
      <circle
        r={HANDLE_HIT_RADIUS}
        fill="transparent"
        style={{ cursor: "ew-resize" }}
        onPointerDown={onPointerDown}
      />
      <circle r={HANDLE_RADIUS} fill="white" stroke={color} strokeWidth={1.5} />
    </g>
  );
}
