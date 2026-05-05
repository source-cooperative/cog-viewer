import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import { useState } from "react";
import type { CogState, CogStateUpdate, Mode } from "../state/types";

const COLORMAP_NAMES = Object.keys(COLORMAP_INDEX).sort();

type Props = {
  state: CogState;
  update: (patch: CogStateUpdate) => void;
};

const FIELD: React.CSSProperties = {
  display: "grid",
  gap: 4,
};
const LEGEND: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: "#333",
};

export function ControlsPanel({ state, update }: Props) {
  const [open, setOpen] = useState(true);

  const effectiveBands = state.bands ?? [1, 2, 3];
  const effectiveRescale = state.rescale?.[0] ?? [0, 1];

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 300,
        background: "rgba(255,255,255,0.96)",
        padding: 12,
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        zIndex: 5,
        display: "grid",
        gap: 10,
        fontSize: 13,
        maxHeight: "calc(100vh - 32px)",
        overflowY: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          all: "unset",
          cursor: "pointer",
          fontWeight: 700,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        Rendering
        <span style={{ fontSize: 11 }}>{open ? "▾" : "◂"}</span>
      </button>

      {open && (
        <>
          <div style={{ fontSize: 11, color: "#666", wordBreak: "break-all" }}>
            {state.url}
          </div>

          <div style={FIELD}>
            <span style={LEGEND}>Mode</span>
            <select
              aria-label="mode"
              value={state.mode ?? "rgb"}
              onChange={(e) =>
                update({
                  mode: e.target.value as Mode,
                  bands:
                    e.target.value === "single" ? [effectiveBands[0]] : [1, 2, 3],
                })
              }
            >
              <option value="rgb">RGB / composite</option>
              <option value="single">Single band + colormap</option>
            </select>
          </div>

          {state.mode === "rgb" && (
            <div style={FIELD}>
              <span style={LEGEND}>Bands (R, G, B, 1-indexed)</span>
              <div style={{ display: "flex", gap: 6 }}>
                {(["R", "G", "B"] as const).map((label, i) => (
                  <input
                    key={label}
                    aria-label={`band-${label.toLowerCase()}`}
                    type="number"
                    min={1}
                    value={effectiveBands[i] ?? ""}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      const next = [...effectiveBands];
                      next[i] = Number.isFinite(n) && n >= 1 ? n : 1;
                      update({ bands: next });
                    }}
                    style={{ width: 56 }}
                  />
                ))}
              </div>
            </div>
          )}

          {state.mode === "single" && (
            <div style={FIELD}>
              <span style={LEGEND}>Band (1-indexed)</span>
              <input
                aria-label="band"
                type="number"
                min={1}
                value={effectiveBands[0] ?? 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  update({ bands: [Number.isFinite(n) && n >= 1 ? n : 1] });
                }}
                style={{ width: 80 }}
              />
            </div>
          )}

          <div style={FIELD}>
            <span style={LEGEND}>Rescale (min, max)</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                aria-label="rescale-min"
                type="number"
                step="any"
                value={effectiveRescale[0]}
                onChange={(e) =>
                  update({
                    rescale: [[Number(e.target.value), effectiveRescale[1]]],
                  })
                }
                style={{ width: 100 }}
              />
              <input
                aria-label="rescale-max"
                type="number"
                step="any"
                value={effectiveRescale[1]}
                onChange={(e) =>
                  update({
                    rescale: [[effectiveRescale[0], Number(e.target.value)]],
                  })
                }
                style={{ width: 100 }}
              />
            </div>
          </div>

          {state.mode === "single" && (
            <div style={FIELD}>
              <span style={LEGEND}>Colormap</span>
              <select
                aria-label="colormap"
                value={state.colormap ?? "viridis"}
                onChange={(e) => update({ colormap: e.target.value })}
              >
                {COLORMAP_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={FIELD}>
            <span style={LEGEND}>Nodata</span>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                aria-label="nodata-mode"
                value={
                  state.nodata === "off"
                    ? "off"
                    : state.nodata === null
                      ? "auto"
                      : "value"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "auto") update({ nodata: null });
                  else if (v === "off") update({ nodata: "off" });
                  else update({ nodata: 0 });
                }}
              >
                <option value="auto">Auto (from COG)</option>
                <option value="value">Value</option>
                <option value="off">Off</option>
              </select>
              {typeof state.nodata === "number" && (
                <input
                  aria-label="nodata-value"
                  type="number"
                  step="any"
                  value={state.nodata}
                  onChange={(e) => update({ nodata: Number(e.target.value) })}
                  style={{ width: 100 }}
                />
              )}
            </div>
          </div>

          <div style={FIELD}>
            <span style={LEGEND}>Opacity ({state.opacity.toFixed(2)})</span>
            <input
              aria-label="opacity"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.opacity}
              onChange={(e) => update({ opacity: Number(e.target.value) })}
            />
          </div>

          <button
            type="button"
            onClick={() =>
              update({
                url: null,
                mode: null,
                bands: null,
                rescale: null,
                colormap: null,
                nodata: null,
                colorspace: null,
              })
            }
          >
            Open another COG
          </button>
        </>
      )}
    </div>
  );
}
