import { formatBytes } from "../render/format-bytes";
import { shouldShowBothSizes } from "../render/non-tiled-sizes";
import type { NonTiledStatus } from "../render/non-tiled-status";

type Props = {
  status: NonTiledStatus;
  onConfirm: () => void;
};

export function NonTiledBanner({ status, onConfirm }: Props) {
  if (status === null) return null;

  const both = shouldShowBothSizes(status.decodedBytes, status.diskBytes);
  const sizeLine = both
    ? `Download: ${formatBytes(status.diskBytes)} · Decoded: ${formatBytes(status.decodedBytes)}.`
    : `${formatBytes(Math.max(status.decodedBytes, status.diskBytes))}.`;

  return (
    <div
      role="status"
      className="panel"
      style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 15,
        padding: "10px 14px",
        background: "#7a5a1a",
        color: "#ffffff",
        borderRadius: "var(--radius)",
        maxWidth: "min(640px, calc(100vw - 32px))",
        display: "grid",
        gap: 6,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        Not a Cloud Optimized GeoTIFF. {sizeLine}
      </div>
      <div>
        {status.kind === "confirm"
          ? "Loading will fetch and decode the whole file in your browser."
          : "Loading whole image — slower than a COG."}
      </div>
      <div style={{ opacity: 0.85 }}>
        Convert with{" "}
        <code style={{ background: "rgba(0,0,0,0.25)", padding: "1px 4px", borderRadius: 3 }}>
          gdal_translate -of COG in.tif out.tif
        </code>
      </div>
      {status.kind === "confirm" && (
        <button
          type="button"
          onClick={onConfirm}
          style={{
            justifySelf: "start",
            background: "#fff",
            color: "#3a2a08",
            border: "none",
            padding: "6px 10px",
            borderRadius: 4,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Load anyway
        </button>
      )}
    </div>
  );
}
