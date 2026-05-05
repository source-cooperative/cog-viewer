import { useState } from "react";
import { EXAMPLES } from "../data/examples";

type Props = { onSubmit: (url: string) => void };

export function EmptyState({ onSubmit }: Props) {
  const [value, setValue] = useState("");

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.4)",
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          width: 420,
          display: "grid",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Open a COG</h2>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Paste a COG URL</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="COG URL (https://…)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ flex: 1, padding: "6px 8px" }}
            />
            <button type="button" disabled={!value} onClick={() => onSubmit(value)}>
              Load
            </button>
          </div>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Or pick an example</span>
          <select
            aria-label="example"
            defaultValue=""
            onChange={(e) => e.target.value && onSubmit(e.target.value)}
          >
            <option value="" disabled>
              Choose…
            </option>
            {EXAMPLES.map((ex) => (
              <option key={ex.url} value={ex.url}>
                {ex.title}
              </option>
            ))}
          </select>
        </label>

        <label
          data-testid="drop-zone"
          style={{
            border: "2px dashed #ccc",
            borderRadius: 6,
            padding: 16,
            textAlign: "center",
            cursor: "pointer",
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) onSubmit(URL.createObjectURL(f));
          }}
        >
          <span>Or drop a .tif file</span>
          <input
            data-testid="file-input"
            type="file"
            accept=".tif,.tiff"
            style={{ display: "block", margin: "8px auto 0" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSubmit(URL.createObjectURL(f));
            }}
          />
        </label>
      </div>
    </div>
  );
}
