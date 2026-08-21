import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { GeoTIFF } from "@developmentseed/geotiff";
import { ColormapPicker, type ColormapOption } from "./ColormapPicker";
import { InfoIcon, Tooltip } from "./Tooltip";
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
import { MetadataPanel } from "./MetadataPanel";

/** Default 2-98% percentile range used as the displayed rescale before the
 * user picks a preset or types a custom range. Matches QGIS / rio-tiler. */
const DEFAULT_PERCENTILE_LO = 0.02;
const DEFAULT_PERCENTILE_HI = 0.98;

const RGB_CHANNELS = [
  { label: "R", color: "#d63838" },
  { label: "G", color: "#2c8a2c" },
  { label: "B", color: "#2a6db8" },
] as const;

const COLORMAP_NAMES = Object.keys(COLORMAP_INDEX).sort();
const COLORMAP_ROW_COUNT = Object.keys(COLORMAP_INDEX).length;
const COLORMAP_OPTIONS: ColormapOption[] = COLORMAP_NAMES.map((name) => ({
  name,
  label: name,
  rowIndex: (COLORMAP_INDEX as Record<string, number>)[name],
}));

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
  geotiff: GeoTIFF | null;
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

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="section" open={defaultOpen}>
      <summary className="section-title">{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function Field({
  label,
  info,
  children,
}: {
  label: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span
        className="field-label"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        {label}
        {info && <InfoIcon text={info} />}
      </span>
      {children}
    </label>
  );
}

const HELP = {
  basemap:
    "Background map style under the COG. 'Auto' follows your system color scheme; 'None' shows the COG over a flat dark surface.",
  labels:
    "When checked, basemap labels (place names, roads) draw on top of the COG; when off, they sit beneath it.",
  mode:
    "RGB / composite picks one band per output channel for true- or false-color images. Single band sends one band's value through a colormap.",
  bandsRgb:
    "Pick which COG band feeds each output channel. Native order is usually 1=red, 2=green, 3=blue; reorder to make false-color (e.g. NIR=4 → R) composites.",
  bandSingle:
    "Which band's pixel values feed the colormap.",
  rescale:
    "Maps a window of source values to the colormap input. Drag the histogram handles, type values, or pick a preset. The histogram below shows the distribution of pixel values for this band.",
  colormap:
    "Color lookup applied to the rescaled value (after the curve, before nodata).",
  nodata:
    "Auto reads the nodata value from the COG's GDAL_NODATA tag, and also treats NaN as nodata for float data (matches QGIS/GDAL); Value lets you specify one in source units; Off renders every pixel.",
  opacity: "Layer transparency, 0 (invisible) to 1 (fully opaque).",
  preset2to98:
    "2nd–98th percentile of pixel values. Ignores extreme outliers — the QGIS / rio-tiler default for most data.",
  presetMinMax:
    "Map the full pixel-value extent of the band. Best when there are no outliers, or when you want to see the absolute range.",
  curve:
    "How values inside the rescale window are distributed across the colormap. Linear is uniform; Log and Sqrt expand the lower part of the window — useful when most variation lives near the bottom.",
  curveLinear:
    "Equal source-value ranges map to equal colormap ranges. Best for evenly distributed data.",
  curveSqrt:
    "Square-root mapping. Gently expands lower values — try this on moderately skewed data when Linear feels too dark.",
  curveLog:
    "Logarithmic mapping (log(1 + 99·x)). Aggressively expands lower values — best for heavily skewed data with a long tail of large values.",
} as const;

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
      <Field label="Rescale" info={HELP.rescale}>
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
        {RGB_CHANNELS.map(({ label, color }, i) => (
          <RescaleRow
            key={label}
            stats={perBandStats[i]}
            value={values[i]}
            onChange={(next) => setChannel(i, next)}
            color={color}
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
  const options: { value: Stretch; label: string; help: string }[] = [
    { value: "linear", label: "Linear", help: HELP.curveLinear },
    { value: "sqrt", label: "Sqrt", help: HELP.curveSqrt },
    { value: "log", label: "Log", help: HELP.curveLog },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {options.map((o) => (
        <Tooltip key={o.value} text={o.help}>
          <PresetButton
            label={o.label}
            active={value === o.value}
            onClick={() => onChange(o.value)}
          />
        </Tooltip>
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
      <Tooltip text={HELP.preset2to98}>
        <PresetButton
          label="2–98%"
          active={active === "percentile"}
          onClick={onPercentile}
        />
      </Tooltip>
      <Tooltip text={HELP.presetMinMax}>
        <PresetButton
          label="Min/Max"
          active={active === "minmax"}
          onClick={onMinMax}
        />
      </Tooltip>
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
  geotiff,
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
    <details
      className="panel"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open
          ? "open"
          : "closed";
        if (next !== state.panel) setOpen(next === "open");
      }}
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 280,
        maxWidth: "calc(100vw - 32px)",
        padding: "8px 12px",
        zIndex: 5,
        display: "block",
        maxHeight: "calc(100vh - 32px)",
        overflowX: "hidden",
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <summary className="panel-header">Options</summary>

      <div className="panel-body">
        {state.urls.length > 0 && (
            <>
              {geotiff && (
                <CollapsibleSection title="Metadata">
                  <MetadataPanel geotiff={geotiff} />
                </CollapsibleSection>
              )}

              <CollapsibleSection title="Rendering" defaultOpen>
                <Field label="Mode" info={HELP.mode}>
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
                  <Field label="Bands (R, G, B)" info={HELP.bandsRgb}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 6,
                      }}
                    >
                      {RGB_CHANNELS.map(({ label }, i) => (
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
                  <Field label="Band" info={HELP.bandSingle}>
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
                  <Field label="Colormap" info={HELP.colormap}>
                    <ColormapPicker
                      colormapsPngUrl={colormapsPngUrl}
                      rowCount={COLORMAP_ROW_COUNT}
                      value={state.colormap ?? "viridis"}
                      options={COLORMAP_OPTIONS}
                      onChange={(name) => update({ colormap: name })}
                    />
                  </Field>
                )}

                <Field label="Nodata" info={HELP.nodata}>
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

                <Field label="Curve" info={HELP.curve}>
                  <StretchRow
                    value={state.stretch}
                    onChange={(stretch) => update({ stretch })}
                  />
                </Field>

                <Field
                  label={`Gamma (${state.gamma.toFixed(2)})`}
                  info="Power-law correction applied AFTER the curve. Gamma > 1 lifts shadows; gamma < 1 deepens them. 1.0 disables it."
                >
                  <input
                    aria-label="gamma"
                    type="range"
                    min={0.1}
                    max={3}
                    step={0.05}
                    value={state.gamma}
                    onChange={(e) => update({ gamma: Number(e.target.value) })}
                    onDoubleClick={() => update({ gamma: 1 })}
                  />
                </Field>
              </CollapsibleSection>
            </>
          )}

          <CollapsibleSection title="Map">
            <Field label="Basemap" info={HELP.basemap}>
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
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  Labels above data
                  <InfoIcon text={HELP.labels} />
                </span>
              </label>
            </Field>

            {state.urls.length > 0 && (
              <Field
                label={`Opacity (${state.opacity.toFixed(2)})`}
                info={HELP.opacity}
              >
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
            )}
          </CollapsibleSection>
      </div>
    </details>
  );
}
