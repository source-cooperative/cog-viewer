type Props = {
  message: string | null;
  onDismiss: () => void;
  /** "error" (default) is a red alert; "info" is a neutral status notice used
   * for non-blocking notices like the non-tiled whole-file-mode banner. */
  variant?: "error" | "info";
};

export function Toast({ message, onDismiss, variant = "error" }: Props) {
  if (!message) return null;
  const isInfo = variant === "info";
  return (
    <div
      role={isInfo ? "status" : "alert"}
      className="panel"
      style={{
        position: "absolute",
        // Offset the info notice so it doesn't sit on top of an error toast
        // in the rare case both are visible.
        bottom: isInfo ? 72 : 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: isInfo ? "#1e3a5f" : "#7a1a1a",
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
    lower.includes("unrecognized")
  ) {
    return "This file does not look like a valid Cloud Optimized GeoTIFF.";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "The COG URL returned 404 Not Found.";
  }
  return `Could not load the COG: ${msg}`;
}
