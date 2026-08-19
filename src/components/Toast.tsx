type Props = {
  message: string | null;
  onDismiss: () => void;
  /** "error" (default) draws a red, assertive banner; "warning" draws an amber,
   * polite one for non-blocking notices. */
  level?: "error" | "warning";
};

export function Toast({ message, onDismiss, level = "error" }: Props) {
  if (!message) return null;
  const isWarning = level === "warning";
  return (
    <div
      role={isWarning ? "status" : "alert"}
      className="panel"
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: isWarning ? "#7a5a1a" : "#7a1a1a",
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

/** Map a thrown error or rejected fetch to a one-line user-facing message.
 * Pass `source: "tile"` when the error comes from a per-tile Range request
 * rather than from opening the COG, so the fallback message is accurate. */
export function humanizeError(
  err: unknown,
  source: "cog" | "tile" = "cog",
): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  // "Failed to fetch" from the browser Fetch API indicates a network-level
  // error (CORS, offline, etc.). @chunkd/source-http wraps ALL errors as
  // "Failed to fetch: <url>" (note the colon + URL), so we must exclude that
  // pattern to avoid misattributing server/rate-limit errors as CORS. Our
  // geotiff library also throws "Failed to fetch bytes from offset:N ..." when
  // the server returns fewer bytes than requested — exclude "bytes" too.
  if (
    lower.includes("cors") ||
    lower.includes("networkerror") ||
    (lower.includes("failed to fetch") &&
      !lower.includes("failed to fetch:") &&
      !lower.includes("bytes"))
  ) {
    return "Could not load the COG. The host may not allow cross-origin requests (CORS) — it needs Access-Control-Allow-Origin and Access-Control-Expose-Headers: Content-Range.";
  }
  if (
    lower.includes("not a tiff") ||
    lower.includes("invalid tiff") ||
    lower.includes("unrecognized")
  ) {
    return "This file does not look like a valid Cloud Optimized GeoTIFF.";
  }
  if (lower.includes("not tiled")) {
    return "This GeoTIFF is stored in strips, not internal tiles — it isn't a Cloud Optimized GeoTIFF, so the viewer can't stream it. Re-encode it as a COG with internal tiling and overviews.";
  }
  if (
    lower.includes("unsupported") ||
    lower.includes("compression") ||
    lower.includes("decode")
  ) {
    return "The viewer couldn't decode this COG's tiles (possibly an unsupported compression).";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "The COG URL returned 404 Not Found.";
  }
  if (source === "tile") {
    // @chunkd/source-http wraps tile Range request failures as
    // "Failed to fetch: <url>". Show a neutral message; the COG itself
    // loaded fine so "Could not load the COG" would be misleading.
    if (lower.startsWith("failed to fetch:") && lower.includes("http")) {
      return "A tile failed to load — the server may be temporarily unavailable.";
    }
    return `A tile failed to load: ${msg}`;
  }
  return `Could not load the COG: ${msg}`;
}
