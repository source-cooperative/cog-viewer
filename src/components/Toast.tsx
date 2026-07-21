type Props = {
  message: string | null;
  onDismiss: () => void;
};

export function Toast({ message, onDismiss }: Props) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="panel"
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#7a1a1a",
        color: "#ffffff",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        zIndex: 20,
        display: "flex",
        gap: 12,
        alignItems: "center",
        maxWidth: "min(640px, calc(100vw - 32px))",
      }}
    >
      <span style={{ fontSize: 13 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "transparent",
          color: "#ffffff",
          border: "1px solid rgba(255,255,255,0.6)",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

/** Map a thrown error or rejected fetch to a one-line user-facing message. */
export function humanizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("cors") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror")
  ) {
    return "Could not load the COG. The host may not allow cross-origin requests (CORS) — it needs Access-Control-Allow-Origin and Access-Control-Expose-Headers: Content-Range.";
  }
  if (
    lower.includes("not a tiff") ||
    lower.includes("invalid tiff") ||
    lower.includes("unrecognized") ||
    // @cogeotiff/core throws "Only tiff supported version:<n>" when the bytes
    // aren't a TIFF at all (e.g. a Parquet file, whose header parses to a
    // nonsense version number).
    lower.includes("supported version") ||
    lower.includes("only tiff")
  ) {
    return "This file does not look like a valid Cloud Optimized GeoTIFF.";
  }
  if (
    lower.includes("coordinate transformation") ||
    lower.includes("geotiff model type") ||
    lower.includes("projection name")
  ) {
    return "This COG uses a map projection this viewer can't display. Only common projections are supported.";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "The COG URL returned 404 Not Found.";
  }
  return `Could not load the COG: ${msg}`;
}
