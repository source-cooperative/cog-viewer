type Sample = {
  band: number;
  name: string | null;
  value: number;
  isNodata: boolean;
};

export type InspectorState = {
  /** Cursor position in viewport pixels (top-left origin). */
  x: number;
  y: number;
  /** Geographic location under the cursor. */
  lng: number;
  lat: number;
  samples: Sample[];
};

type Props = {
  pin: InspectorState | null;
  onClose: () => void;
};

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(4);
}

function formatLngLat(lng: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function Inspector({ pin, onClose }: Props) {
  if (!pin) return null;
  const { x, y, lng, lat, samples } = pin;
  // Anchor to bottom-right of the click by default; flip near the right edge
  // so the panel never escapes the viewport. Vertical flip handled similarly.
  const flipX = x > window.innerWidth - 200;
  const flipY = y > window.innerHeight - 120;
  const left = flipX ? x - 12 : x + 12;
  const top = flipY ? y - 12 : y + 12;
  return (
    <div
      className="panel"
      style={{
        position: "absolute",
        left,
        top,
        transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
        padding: "6px 10px",
        zIndex: 6,
        fontSize: 12,
        minWidth: 140,
        display: "grid",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
          {formatLngLat(lng, lat)}
        </div>
        <button
          type="button"
          aria-label="close-inspector"
          onClick={onClose}
          style={{
            all: "unset",
            cursor: "pointer",
            color: "var(--text-muted)",
            fontSize: 14,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>
      {samples.length === 0 ? (
        <div style={{ color: "var(--text-muted)" }}>no data loaded</div>
      ) : (
        <div style={{ display: "grid", gap: 2 }}>
          {samples.map((s) => (
            <div
              key={s.band}
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                gap: 8,
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>
                {s.name ? `${s.band} ${s.name}` : `band ${s.band}`}
              </span>
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                  opacity: s.isNodata ? 0.5 : 1,
                }}
              >
                {s.isNodata ? "nodata" : formatValue(s.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
