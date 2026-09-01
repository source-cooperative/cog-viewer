import { useState } from "react";
import { EXAMPLES } from "../data/examples";

type Props = { onSubmit: (urls: string[]) => void };

export function EmptyState({ onSubmit }: Props) {
  const [value, setValue] = useState("");

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(44, 50, 51, 0.32)",
        zIndex: 10,
        padding: 16,
      }}
    >
      <div
        className="panel"
        style={{
          padding: 24,
          width: "min(440px, 100%)",
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <span className="panel-header">COG Viewer</span>
          <h2 style={{ margin: 0, fontWeight: 600, fontSize: 20 }}>Open a Cloud Optimized GeoTIFF</h2>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="field-label">Paste a COG URL</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              aria-label="cog-url"
              placeholder="https://…/cog.tif"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="primary"
              disabled={!value}
              onClick={() => onSubmit([value])}
            >
              Load
            </button>
          </div>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="field-label">Or pick an example</span>
          <select
            aria-label="example"
            defaultValue=""
            onChange={(e) => {
              const idx = Number(e.target.value);
              if (isNaN(idx)) return;
              const ex = EXAMPLES[idx];
              if (!ex) return;
              onSubmit(ex.urls ?? [ex.url!]);
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {EXAMPLES.map((ex, idx) => (
              <option key={idx} value={idx}>
                {ex.title}
              </option>
            ))}
          </select>
        </label>

        <label
          data-testid="drop-zone"
          style={{
            border: "1.5px dashed var(--border-strong)",
            borderRadius: "var(--radius)",
            padding: 18,
            textAlign: "center",
            cursor: "pointer",
            background: "var(--surface-muted)",
            color: "var(--text-muted)",
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) onSubmit([URL.createObjectURL(f)]);
          }}
        >
          <div style={{ marginBottom: 8 }}>Or drop a .tif file</div>
          <input
            data-testid="file-input"
            type="file"
            accept=".tif,.tiff"
            style={{ display: "block", margin: "0 auto" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSubmit([URL.createObjectURL(f)]);
            }}
          />
        </label>
      </div>
    </div>
  );
}
