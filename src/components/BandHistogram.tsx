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

/** SVG histogram + HTML handle overlays for a rescale range. The SVG bars
 * stretch to fill the width via `preserveAspectRatio="none"`; the handles
 * themselves are absolutely-positioned `<div>`s so they stay perfectly
 * circular regardless of the container's aspect ratio. */
export function BandHistogram({
  stats,
  value,
  onChange,
  color = "var(--text)",
  height = 64,
  label,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Track which handle (low/high) is being dragged. null = idle.
  const [dragging, setDragging] = useState<"lo" | "hi" | null>(null);

  const range = stats.max - stats.min;
  const safeRange = range > 0 ? range : 1;
  // Bar heights use log(1+count) so heavily skewed distributions (a single
  // huge bin near zero plus a long thin tail) stay readable. log1p(0) = 0
  // so empty bins still draw nothing; log1p(big) tames the spike without
  // hiding it. For well-distributed data this is nearly imperceptible.
  const logMaxBin = useMemo(() => {
    let max = 0;
    for (const c of stats.histogram) if (c > max) max = c;
    return Math.log1p(max) || 1;
  }, [stats.histogram]);

  const toFrac = (v: number) =>
    Math.max(0, Math.min(1, (v - stats.min) / safeRange));
  const fromFrac = (f: number) => stats.min + f * safeRange;

  const lo = Math.min(value[0], value[1]);
  const hi = Math.max(value[0], value[1]);
  const loFrac = toFrac(lo);
  const hiFrac = toFrac(hi);

  const xToValue = useCallback(
    (clientX: number): number => {
      const wrap = wrapRef.current;
      if (!wrap) return stats.min;
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0) return stats.min;
      const fx = (clientX - rect.left) / rect.width;
      return fromFrac(Math.max(0, Math.min(1, fx)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats.min, safeRange],
  );

  const beginDrag = useCallback(
    (which: "lo" | "hi") =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        setDragging(which);
      },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const v = xToValue(e.clientX);
      if (dragging === "lo") onChange([Math.min(v, hi), hi]);
      else onChange([lo, Math.max(v, lo)]);
    },
    [dragging, hi, lo, onChange, xToValue],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      setDragging(null);
    },
    [dragging],
  );

  /** Click on the chart background → snap nearest handle and continue as drag. */
  const handleBackgroundDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't hijack a pointerdown that originated on a handle.
      const target = e.target as HTMLElement;
      if (target.dataset.handle) return;
      const v = xToValue(e.clientX);
      const which: "lo" | "hi" =
        Math.abs(v - lo) <= Math.abs(v - hi) ? "lo" : "hi";
      if (which === "lo") onChange([Math.min(v, hi), hi]);
      else onChange([lo, Math.max(v, lo)]);
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
      <div
        ref={wrapRef}
        onPointerDown={handleBackgroundDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          height,
          cursor: dragging ? "grabbing" : "crosshair",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          width="100%"
          height={height}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            pointerEvents: "none",
          }}
        >
          <rect width="100" height={height} fill="var(--surface-muted)" />

          {stats.histogram.map((count, i) => {
            const w = 100 / stats.histogram.length;
            const h = (Math.log1p(count) / logMaxBin) * (height - 4);
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

          <rect
            x={loFrac * 100}
            y={0}
            width={(hiFrac - loFrac) * 100}
            height={height}
            fill={color}
            opacity={0.12}
          />
        </svg>

        <Handle
          xPct={loFrac * 100}
          color={color}
          onPointerDown={beginDrag("lo")}
        />
        <Handle
          xPct={hiFrac * 100}
          color={color}
          onPointerDown={beginDrag("hi")}
        />
      </div>
    </div>
  );
}

const HANDLE_SIZE = 12;

function Handle({
  xPct,
  color,
  onPointerDown,
}: {
  xPct: number;
  color: string;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-handle="true"
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        top: "50%",
        left: `${xPct}%`,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        borderRadius: "50%",
        background: "white",
        border: `1.5px solid ${color}`,
        transform: "translate(-50%, -50%)",
        cursor: "ew-resize",
        boxSizing: "border-box",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
      }}
    />
  );
}
