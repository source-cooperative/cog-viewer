import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  percentileFromHistogram,
  type AutoStats,
  type BandStats,
} from "../render/stats";
import { MAX_BAND_SLOTS } from "../render/tile-loader";
import type {
  Basemap,
  CogState,
  CogStateUpdate,
  Mode,
  Stretch,
} from "../state/types";
import { BandHistogram } from "./BandHistogram";

/** Default 2-98% percentile range used as the displayed rescale before the
 * user picks a preset or types a custom range. Matches QGIS / rio-tiler. */
const DEFAULT_PERCENTILE_LO = 0.02;
const DEFAULT_PERCENTILE_HI = 0.98;

const RGB_CHANNEL_COLORS: [string, string, string] = [
  "#d63838",
  "#2c8a2c",
  "#2a6db8",
];

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

function statsForBand(
  autoStats: AutoStats | null,
  band: number,
): BandStats | null {
  if (!autoStats?.perBand) return autoStats?.global ?? null;
  return autoStats.perBand.get(band) ?? autoStats.global ?? null;
}

/** 2–98% percentile range from a BandStats histogram. Falls back to
 * [min, max] if the histogram is empty (e.g. GDAL_METADATA-only stats). */
function defaultPercentileRange(stats: BandStats): [number, number] {
  const hasBins = stats.histogram.some((b) => b > 0);
  if (!hasBins) return [stats.min, stats.max];
  return [
    percentileFromHistogram(stats, DEFAULT_PERCENTILE_LO),
    percentileFromHistogram(stats, DEFAULT_PERCENTILE_HI),
  ];
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

/** Format a number for display in a numeric input. Trims trailing zeros and
 * stays compact for typical COG ranges (uint8 → integers, reflectance →
 * 4 sig figs). */
function fmt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Round to 4 significant digits without losing integer precision.
  const abs = Math.abs(n);
  if (abs >= 1) return Number(n.toFixed(2));
  return Number(n.toPrecision(4));
}

type RescaleRowProps = {
  stats: BandStats | null;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  color: string;
  label?: string;
  ariaPrefix: string;
};

/** One row of histogram + numeric inputs for a band's rescale range. */
function RescaleRow({
  stats,
  value,
  onChange,
  color,
  label,
  ariaPrefix,
}: RescaleRowProps) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {stats && (
        <BandHistogram
          stats={stats}
          value={value}
          onChange={onChange}
          color={color}
          label={label}
          height={64}
        />
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: label
            ? "16px minmax(0, 1fr) minmax(0, 1fr)"
            : "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 6,
          alignItems: "center",
        }}
      >
        {label && (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            {label}
          </span>
        )}
        <input
          aria-label={`${ariaPrefix}-min`}
          type="number"
          step="any"
          value={fmt(value[0])}
          onChange={(e) => onChange([Number(e.target.value), value[1]])}
        />
        <input
          aria-label={`${ariaPrefix}-max`}
          type="number"
          step="any"
          value={fmt(value[1])}
          onChange={(e) => onChange([value[0], Number(e.target.value)])}
        />
      </div>
    </div>
  );
}

const PRESET_EPSILON = 1e-6;
const rangesMatch = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < PRESET_EPSILON &&
  Math.abs(a[1] - b[1]) < PRESET_EPSILON;

type Preset = "percentile" | "minmax" | "custom";

/** Detect whether the current rescale state matches the 2-98% preset, the
 * Min/Max preset, or neither (custom). When state.rescale is null the app
 * is rendering at the displayed default (2-98%), so that's the active preset. */
function activePreset(
  current: ([number, number] | null)[],
  percentile: ([number, number] | null)[],
  minMax: ([number, number] | null)[],
  isAuto: boolean,
): Preset {
  if (isAuto) return "percentile";
  // Compare per-channel; all channels must match the same preset.
  const matchesPreset = (preset: ([number, number] | null)[]) =>
    current.every((c, i) => {
      const p = preset[i];
      if (!c || !p) return false;
      return rangesMatch(c, p);
    });
  if (matchesPreset(percentile)) return "percentile";
  if (matchesPreset(minMax)) return "minmax";
  return "custom";
}

type RescaleSectionProps = {
  mode: Mode;
  bands: number[];
  autoStats: AutoStats | null;
  state: CogState;
  update: (patch: CogStateUpdate) => void;
};

/** Histogram-driven rescale UI. Displays one scrubber per channel in RGB,
 * one in single-band. The 2–98% percentile and Min/Max presets are
 * toggleable indicators — clicking the active preset is a no-op; clicking
 * the inactive one switches. Clicking 2–98% drops the URL override (so
 * shared links stay clean for the common default). */
function RescaleSection({
  mode,
  bands,
  autoStats,
  state,
  update,
}: RescaleSectionProps) {
  const isAuto = state.rescale === null;

  if (mode === "single") {
    const stats = statsForBand(autoStats, bands[0] ?? 1);
    const percentile = stats ? defaultPercentileRange(stats) : null;
    const minMax: [number, number] | null = stats
      ? [stats.min, stats.max]
      : null;
    const value: [number, number] =
      state.rescale?.[0] ?? percentile ?? [0, 1];

    const preset = activePreset(
      [state.rescale?.[0] ?? null],
      [percentile],
      [minMax],
      isAuto,
    );

    const setValue = (next: [number, number]) => update({ rescale: [next] });

    return (
      <Field label="Rescale">
        <RescaleRow
          stats={stats}
          value={value}
          onChange={setValue}
          color="var(--text)"
          ariaPrefix="rescale"
        />
        <PresetRow
          show={Boolean(stats)}
          active={preset}
          onPercentile={() => update({ rescale: null })}
          onMinMax={() => minMax && setValue(minMax)}
        />
        <StretchRow
          value={state.stretch}
          onChange={(stretch) => update({ stretch })}
        />
      </Field>
    );
  }

  // RGB — three channels. Honor existing per-channel state if present;
  // else fall back to per-band auto percentiles.
  const perBandStats: (BandStats | null)[] = bands
    .slice(0, 3)
    .map((b) => statsForBand(autoStats, b));
  const perBandPercentile: ([number, number] | null)[] = perBandStats.map(
    (s) => (s ? defaultPercentileRange(s) : null),
  );
  const perBandMinMax: ([number, number] | null)[] = perBandStats.map((s) =>
    s ? [s.min, s.max] : null,
  );
  const fromState =
    state.rescale && state.rescale.length >= 3
      ? state.rescale.slice(0, 3)
      : null;
  const values: [number, number][] = [0, 1, 2].map((i) => {
    if (fromState) return fromState[i] ?? [0, 1];
    return perBandPercentile[i] ?? [0, 1];
  });

  const currentPerChannel: ([number, number] | null)[] = fromState
    ? fromState
    : [null, null, null];
  const preset = activePreset(
    currentPerChannel,
    perBandPercentile,
    perBandMinMax,
    isAuto,
  );

  const setChannel = (i: number, next: [number, number]) => {
    const out = values.map((v) => [...v] as [number, number]);
    out[i] = next;
    update({ rescale: out });
  };

  return (
    <Field label="Rescale">
      <div style={{ display: "grid", gap: 8 }}>
        {(["R", "G", "B"] as const).map((label, i) => (
          <RescaleRow
            key={label}
            stats={perBandStats[i]}
            value={values[i]}
            onChange={(next) => setChannel(i, next)}
            color={RGB_CHANNEL_COLORS[i]}
            label={label}
            ariaPrefix={`rescale-${label.toLowerCase()}`}
          />
        ))}
      </div>
      <PresetRow
        show={perBandStats.some((s) => s !== null)}
        active={preset}
        onPercentile={() => update({ rescale: null })}
        onMinMax={() =>
          update({
            rescale: perBandMinMax.map<[number, number]>(
              (m, i) => m ?? values[i],
            ),
          })
        }
      />
      <StretchRow
        value={state.stretch}
        onChange={(stretch) => update({ stretch })}
      />
    </Field>
  );
}

function StretchRow({
  value,
  onChange,
}: {
  value: Stretch;
  onChange: (next: Stretch) => void;
}) {
  const options: { value: Stretch; label: string }[] = [
    { value: "linear", label: "Linear" },
    { value: "sqrt", label: "Sqrt" },
    { value: "log", label: "Log" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        marginTop: 4,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          marginRight: 2,
        }}
      >
        Curve
      </span>
      {options.map((o) => (
        <PresetButton
          key={o.value}
          label={o.label}
          active={value === o.value}
          onClick={() => onChange(o.value)}
        />
      ))}
    </div>
  );
}

function PresetRow({
  show,
  active,
  onMinMax,
  onPercentile,
}: {
  show: boolean;
  active: Preset;
  onMinMax: () => void;
  onPercentile: () => void;
}) {
  if (!show) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
      <PresetButton
        label="2–98%"
        active={active === "percentile"}
        onClick={onPercentile}
      />
      <PresetButton
        label="Min/Max"
        active={active === "minmax"}
        onClick={onMinMax}
      />
    </div>
  );
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={active ? "primary" : undefined}
      style={{ padding: "2px 8px", fontSize: 11 }}
    >
      {label}
    </button>
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
        padding: "8px 12px",
        zIndex: 5,
        display: "grid",
        gap: 12,
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
        <span style={{ fontSize: 24, color: "var(--text-muted)" }}>
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
            <label
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12,
                marginTop: 4,
              }}
            >
              <input
                aria-label="labels-above"
                type="checkbox"
                checked={state.labelsAbove}
                onChange={(e) =>
                  update({ labelsAbove: e.target.checked })
                }
              />
              Labels above data
            </label>
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

              <RescaleSection
                mode={effectiveMode}
                bands={effectiveBands}
                autoStats={autoStats}
                state={state}
                update={update}
              />

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

              <Field label={`Gamma (${state.gamma.toFixed(2)})`}>
                <input
                  aria-label="gamma"
                  type="range"
                  min={0.1}
                  max={3}
                  step={0.05}
                  value={state.gamma}
                  onChange={(e) =>
                    update({ gamma: Number(e.target.value) })
                  }
                  onDoubleClick={() => update({ gamma: 1 })}
                />
              </Field>

              <Field label="Sigmoidal contrast">
                <div style={{ display: "grid", gap: 6 }}>
                  <label
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      fontSize: 12,
                    }}
                  >
                    <input
                      aria-label="sigmoidal-enabled"
                      type="checkbox"
                      checked={state.sigmoidal !== null}
                      onChange={(e) =>
                        update({
                          sigmoidal: e.target.checked
                            ? { contrast: 5, bias: 0.5 }
                            : null,
                        })
                      }
                    />
                    Enabled
                  </label>
                  {state.sigmoidal && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                        gap: 6,
                      }}
                    >
                      <label style={{ display: "grid", gap: 2, fontSize: 11 }}>
                        <span style={{ color: "var(--text-muted)" }}>
                          Contrast ({state.sigmoidal.contrast.toFixed(1)})
                        </span>
                        <input
                          aria-label="sigmoidal-contrast"
                          type="range"
                          min={0.5}
                          max={20}
                          step={0.5}
                          value={state.sigmoidal.contrast}
                          onChange={(e) =>
                            update({
                              sigmoidal: state.sigmoidal && {
                                ...state.sigmoidal,
                                contrast: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label style={{ display: "grid", gap: 2, fontSize: 11 }}>
                        <span style={{ color: "var(--text-muted)" }}>
                          Bias ({state.sigmoidal.bias.toFixed(2)})
                        </span>
                        <input
                          aria-label="sigmoidal-bias"
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={state.sigmoidal.bias}
                          onChange={(e) =>
                            update({
                              sigmoidal: state.sigmoidal && {
                                ...state.sigmoidal,
                                bias: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
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
