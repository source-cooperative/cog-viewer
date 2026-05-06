import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import type { AutoStats } from "../render/stats";
import { MAX_BAND_SLOTS } from "../render/tile-loader";
import type { Basemap, CogState, CogStateUpdate, Mode } from "../state/types";

const COLORMAP_NAMES = Object.keys(COLORMAP_INDEX).sort();

const BASEMAP_OPTIONS: { value: Basemap; label: string }[] = [
  { value: "auto", label: "Auto (system)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "satellite", label: "Satellite" },
  { value: "off", label: "None" },
];

type Props = {
  state: CogState;
  update: (patch: CogStateUpdate) => void;
  bandCount: number | null;
  bandNames: Map<number, string> | null;
  autoStats: AutoStats | null;
};

function bandLabel(idx: number, names: Map<number, string> | null): string {
  const name = names?.get(idx);
  return name ? `${idx} — ${name}` : String(idx);
}

function statsForBands(
  autoStats: AutoStats | null,
  bands: number[],
): [number, number] | null {
  if (!autoStats?.perBand) return null;
  const ranges: [number, number][] = [];
  for (const b of bands) {
    const r = autoStats.perBand.get(b);
    if (r) ranges.push(r);
  }
  if (ranges.length === 0) return autoStats.global;
  let lo = 0;
  let hi = 0;
  for (const [a, b] of ranges) {
    lo += a;
    hi += b;
  }
  return [lo / ranges.length, hi / ranges.length];
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function ControlsPanel({
  state,
  update,
  bandCount,
  bandNames,
  autoStats,
}: Props) {
  const open = state.panel === "open";
  const setOpen = (next: boolean) =>
    update({ panel: next ? "open" : "closed" });

  // The render path falls back to RGB when mode is null (e.g., during the
  // brief window between URL load and the auto-mode effect firing). Mirror
  // that in the UI so the band picker doesn't disappear.
  const effectiveMode: Mode = state.mode ?? "rgb";
  const effectiveBands = state.bands ?? [1, 2, 3];
  const auto = statsForBands(autoStats, effectiveBands);
  const effectiveRescale = state.rescale?.[0] ?? auto ?? [0, 1];
  const isAutoRescale = state.rescale === null;
  // CompositeBands has 4 slots; we always fetch the first up-to-4 bands so
  // users can freely swap among them. Bands beyond that aren't reachable
  // without a re-fetch, so we hide them from the picker.
  const bandOptions = Array.from(
    { length: Math.min(bandCount ?? MAX_BAND_SLOTS, MAX_BAND_SLOTS) },
    (_, i) => i + 1,
  );

  return (
    <div
      className="panel"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 280,
        maxWidth: "calc(100vw - 32px)",
        padding: open ? 14 : "8px 12px",
        zIndex: 5,
        display: "grid",
        gap: open ? 12 : 0,
        maxHeight: "calc(100vh - 32px)",
        overflowX: "hidden",
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span className="panel-header">Options</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {open ? "▾" : "◂"}
        </span>
      </button>

      {open && (
        <>
          <Field label="Basemap">
            <select
              aria-label="basemap"
              value={state.basemap}
              onChange={(e) =>
                update({ basemap: e.target.value as Basemap })
              }
            >
              {BASEMAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {state.url && (
            <>
              <hr className="divider" />

              <Field label="Mode">
                <select
                  aria-label="mode"
                  value={effectiveMode}
                  onChange={(e) =>
                    update({
                      mode: e.target.value as Mode,
                      bands:
                        e.target.value === "single"
                          ? [effectiveBands[0]]
                          : [1, 2, 3],
                    })
                  }
                >
                  <option value="rgb">RGB / composite</option>
                  <option value="single">Single band + colormap</option>
                </select>
              </Field>

              {effectiveMode === "rgb" && (
                <Field label="Bands (R, G, B)">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 6,
                    }}
                  >
                    {(["R", "G", "B"] as const).map((label, i) => (
                      <select
                        key={label}
                        aria-label={`band-${label.toLowerCase()}`}
                        value={effectiveBands[i] ?? bandOptions[0]}
                        onChange={(e) => {
                          const next = [...effectiveBands];
                          next[i] = Number(e.target.value);
                          update({ bands: next });
                        }}
                      >
                        {bandOptions.map((n) => (
                          <option key={n} value={n}>
                            {bandLabel(n, bandNames)}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>
                </Field>
              )}

              {effectiveMode === "single" && (
                <Field label="Band">
                  <select
                    aria-label="band"
                    value={effectiveBands[0] ?? 1}
                    onChange={(e) =>
                      update({ bands: [Number(e.target.value)] })
                    }
                  >
                    {bandOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field
                label={
                  isAutoRescale && auto
                    ? "Rescale (min, max) — auto"
                    : "Rescale (min, max)"
                }
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                    gap: 6,
                  }}
                >
                  <input
                    aria-label="rescale-min"
                    type="number"
                    step="any"
                    value={effectiveRescale[0]}
                    onChange={(e) =>
                      update({
                        rescale: [
                          [Number(e.target.value), effectiveRescale[1]],
                        ],
                      })
                    }
                  />
                  <input
                    aria-label="rescale-max"
                    type="number"
                    step="any"
                    value={effectiveRescale[1]}
                    onChange={(e) =>
                      update({
                        rescale: [
                          [effectiveRescale[0], Number(e.target.value)],
                        ],
                      })
                    }
                  />
                </div>
                {!isAutoRescale && auto && (
                  <button
                    type="button"
                    onClick={() => update({ rescale: null })}
                    style={{
                      justifySelf: "start",
                      padding: "2px 8px",
                      fontSize: 11,
                    }}
                  >
                    Reset to auto
                  </button>
                )}
              </Field>

              {effectiveMode === "single" && (
                <Field label="Colormap">
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
                </Field>
              )}

              <Field label="Nodata">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      typeof state.nodata === "number"
                        ? "minmax(0, 1fr) minmax(0, 1fr)"
                        : "minmax(0, 1fr)",
                    gap: 6,
                  }}
                >
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
                      onChange={(e) =>
                        update({ nodata: Number(e.target.value) })
                      }
                    />
                  )}
                </div>
              </Field>

              <Field label={`Opacity (${state.opacity.toFixed(2)})`}>
                <input
                  aria-label="opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={state.opacity}
                  onChange={(e) =>
                    update({ opacity: Number(e.target.value) })
                  }
                />
              </Field>

            </>
          )}
        </>
      )}
    </div>
  );
}
