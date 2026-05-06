import type {
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  buildCompositeBandsProps,
  COLORMAP_INDEX,
  Colormap,
  CompositeBands,
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Texture } from "@luma.gl/core";
import type { CogState } from "../state/types";
import {
  percentileFromHistogram,
  type AutoStats,
  type BandStats,
} from "./stats";
import {
  FilterNaN,
  Gamma,
  LogStretch,
  PerBandLinearRescale,
  SqrtStretch,
} from "./shader-modules";
import type { MultiBandTileData } from "./tile-loader";

type Range = [number, number];

const RESCALE_EPSILON = 1e-9;
const DEFAULT_PERCENTILE_LO = 0.02;
const DEFAULT_PERCENTILE_HI = 0.98;

const safeRange = ([lo, hi]: Range): Range =>
  lo === hi ? [lo, lo + RESCALE_EPSILON] : [lo, hi];

/** 2–98% percentile range from a band's histogram. Falls back to [min, max]
 * if the histogram is empty (e.g. GDAL_METADATA-only stats with no overview
 * sample). Mirrors the displayed default in ControlsPanel. */
function autoRangeFor(stats: BandStats): Range {
  const hasBins = stats.histogram.some((b) => b > 0);
  if (!hasBins) return [stats.min, stats.max];
  return [
    percentileFromHistogram(stats, DEFAULT_PERCENTILE_LO),
    percentileFromHistogram(stats, DEFAULT_PERCENTILE_HI),
  ];
}

function statsForBand(
  autoStats: AutoStats | null,
  band: number,
): BandStats | null {
  if (!autoStats?.perBand) return autoStats?.global ?? null;
  return autoStats.perBand.get(band) ?? autoStats.global ?? null;
}

/** Resolve a single rescale window. Falls back to the 2–98% percentile of
 * the chosen band when the user hasn't set an override. */
function effectiveRescale(
  state: CogState,
  autoStats: AutoStats | null,
  band: number,
): Range | null {
  if (state.rescale && state.rescale.length > 0) {
    return safeRange(state.rescale[0]);
  }
  const stats = statsForBand(autoStats, band);
  return stats ? safeRange(autoRangeFor(stats)) : null;
}

/** Resolve per-channel rescale for RGB mode: returns three [min, max] pairs.
 * If state.rescale has 3+ pairs, use them as R/G/B. If it has 1, broadcast.
 * Otherwise falls back to the 2–98% percentile of each channel's band. */
function effectivePerBandRescale(
  state: CogState,
  autoStats: AutoStats | null,
  bands: number[],
): { mins: [number, number, number]; maxs: [number, number, number] } | null {
  if (state.rescale && state.rescale.length > 0) {
    const pairs =
      state.rescale.length >= 3
        ? state.rescale.slice(0, 3).map(safeRange)
        : [
            safeRange(state.rescale[0]),
            safeRange(state.rescale[0]),
            safeRange(state.rescale[0]),
          ];
    return {
      mins: [pairs[0][0], pairs[1][0], pairs[2][0]],
      maxs: [pairs[0][1], pairs[1][1], pairs[2][1]],
    };
  }
  // No user override → derive per-channel 2–98% from autoStats.
  if (!autoStats?.perBand && !autoStats?.global) return null;
  const ranges: [Range, Range, Range] = [
    [0, 1],
    [0, 1],
    [0, 1],
  ];
  for (let i = 0; i < 3; i++) {
    const band = bands[i] ?? bands[bands.length - 1] ?? 1;
    const stats = statsForBand(autoStats, band);
    ranges[i] = stats ? safeRange(autoRangeFor(stats)) : [0, 1];
  }
  return {
    mins: [ranges[0][0], ranges[1][0], ranges[2][0]],
    maxs: [ranges[0][1], ranges[1][1], ranges[2][1]],
  };
}

/** Push the optional adjustments common to RGB and single-band modes,
 * in canonical order: stretch curve → gamma. Both expect input clamped
 * to 0..1, which the preceding rescale module guarantees. */
function pushAdjustments(state: CogState, pipeline: RasterModule[]): void {
  if (state.stretch === "log") {
    pipeline.push({ module: LogStretch, props: { strength: 99 } });
  } else if (state.stretch === "sqrt") {
    pipeline.push({ module: SqrtStretch });
  }
  if (state.gamma !== 1) {
    pipeline.push({ module: Gamma, props: { gamma: state.gamma } });
  }
}

function effectiveNodata(
  state: CogState,
  perTileNodata: number | null,
): number | null {
  if (state.nodata === "off") return null;
  if (typeof state.nodata === "number") return state.nodata;
  return perTileNodata;
}

/** Build the nodata-discard module appropriate for the chosen value.
 * Float32 COGs frequently use NaN as the nodata sentinel; FilterNoDataVal's
 * `color.r == nodata` comparison is always false for NaN per IEEE 754, so
 * we route NaN nodata through a custom isnan() shader instead. */
function nodataModule(
  nodata: number,
  sampleScale: number,
): RasterModule | null {
  if (Number.isNaN(nodata)) {
    return { module: FilterNaN };
  }
  if (!Number.isFinite(nodata)) return null;
  return {
    module: FilterNoDataVal,
    props: { value: nodata / sampleScale },
  };
}

/** Pick an existing band name from `data.bands`, falling back to the first
 * cached band (or null if none). Used to clamp user-selected indexes to
 * what was actually fetched. */
function pickBand(
  data: MultiBandTileData,
  preferred: number | undefined,
): string | null {
  if (preferred != null) {
    const key = String(preferred);
    if (data.bands.has(key)) return key;
  }
  const first = data.bands.keys().next();
  return first.done ? null : first.value;
}

/** RGB renderTile: composes user-selected bands into RGB via
 * `CompositeBands`, then rescales and discards nodata. Re-renders without
 * a re-fetch when the selection changes (within the cached band set). */
export function buildRgbCompositeRenderTile(
  state: CogState,
  autoStats: AutoStats | null,
) {
  return function renderTile(data: MultiBandTileData): RenderTileResult {
    if (data.bands.size === 0) return { renderPipeline: [] };
    const requested = state.bands ?? [1, 2, 3];
    const r = pickBand(data, requested[0]);
    if (!r) return { renderPipeline: [] };
    const mapping: { r: string; g?: string; b?: string } = { r };
    const g = pickBand(data, requested[1]);
    if (g) mapping.g = g;
    const b = pickBand(data, requested[2]);
    if (b) mapping.b = b;

    const compositeProps = buildCompositeBandsProps(mapping, data.bands);
    const pipeline: RasterModule[] = [
      { module: CompositeBands, props: compositeProps },
    ];

    // Filter nodata BEFORE any rescale / gamma so the comparison happens
    // against the texture's native sample value. NaN nodata uses the
    // custom isnan() shader; everything else uses FilterNoDataVal with the
    // value normalized into the GPU's sample space (uint8 255 → 1.0 for
    // r8unorm).
    const nodata = effectiveNodata(state, data.nodata);
    if (nodata !== null) {
      const module = nodataModule(nodata, data.sampleScale);
      if (module) pipeline.push(module);
    }

    const perBand = effectivePerBandRescale(state, autoStats, requested);
    if (perBand) {
      pipeline.push({
        module: PerBandLinearRescale,
        props: {
          rescaleMin: [
            perBand.mins[0] / data.sampleScale,
            perBand.mins[1] / data.sampleScale,
            perBand.mins[2] / data.sampleScale,
          ],
          rescaleMax: [
            perBand.maxs[0] / data.sampleScale,
            perBand.maxs[1] / data.sampleScale,
            perBand.maxs[2] / data.sampleScale,
          ],
        },
      });
    }

    pushAdjustments(state, pipeline);

    return { renderPipeline: pipeline };
  };
}

/** Single-band renderTile. Uses CompositeBands to broadcast one band into
 * all RGB output channels (so the colormap can sample `color.r`), then
 * rescales, colormaps, and discards nodata. */
export function buildSingleCompositeRenderTile(
  state: CogState,
  colormapTexture: Texture,
  autoStats: AutoStats | null,
) {
  const name = (state.colormap ?? "viridis").toLowerCase();
  const colormapIndex =
    (COLORMAP_INDEX as Record<string, number>)[name] ?? COLORMAP_INDEX.viridis;
  return function renderTile(data: MultiBandTileData): RenderTileResult {
    if (data.bands.size === 0) return { renderPipeline: [] };
    const band = pickBand(data, state.bands?.[0]);
    if (!band) return { renderPipeline: [] };
    const compositeProps = buildCompositeBandsProps(
      { r: band, g: band, b: band },
      data.bands,
    );
    const pipeline: RasterModule[] = [
      { module: CompositeBands, props: compositeProps },
    ];

    // Filter nodata BEFORE rescale / gamma / colormap so the comparison
    // runs against the texture's native sample value (NaN-aware via
    // nodataModule).
    const nodata = effectiveNodata(state, data.nodata);
    if (nodata !== null) {
      const module = nodataModule(nodata, data.sampleScale);
      if (module) pipeline.push(module);
    }

    const rescale = effectiveRescale(
      state,
      autoStats,
      state.bands?.[0] ?? 1,
    );
    if (rescale) {
      pipeline.push({
        module: LinearRescale,
        props: {
          rescaleMin: rescale[0] / data.sampleScale,
          rescaleMax: rescale[1] / data.sampleScale,
        },
      });
    }

    pushAdjustments(state, pipeline);

    pipeline.push({
      module: Colormap,
      props: { colormapTexture, colormapIndex, reversed: false },
    });

    return { renderPipeline: pipeline };
  };
}
