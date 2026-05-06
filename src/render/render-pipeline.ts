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
import { Gamma, PerBandLinearRescale, Sigmoidal } from "./shader-modules";
import type { MultiBandTileData } from "./tile-loader";

type Range = [number, number];

const RESCALE_EPSILON = 1e-9;
const safeRange = ([lo, hi]: Range): Range =>
  lo === hi ? [lo, lo + RESCALE_EPSILON] : [lo, hi];

function effectiveRescale(state: CogState): Range | null {
  if (state.rescale && state.rescale.length > 0) {
    return safeRange(state.rescale[0]);
  }
  return null;
}

/** Resolve per-channel rescale for RGB mode: returns three [min, max] pairs.
 * If state.rescale has 3+ pairs, use them as R/G/B. If it has 1, broadcast.
 * Returns null if no rescale is configured. */
function effectivePerBandRescale(
  state: CogState,
): { mins: [number, number, number]; maxs: [number, number, number] } | null {
  if (!state.rescale || state.rescale.length === 0) return null;
  const pairs =
    state.rescale.length >= 3
      ? state.rescale.slice(0, 3).map(safeRange)
      : [safeRange(state.rescale[0]), safeRange(state.rescale[0]), safeRange(state.rescale[0])];
  return {
    mins: [pairs[0][0], pairs[1][0], pairs[2][0]],
    maxs: [pairs[0][1], pairs[1][1], pairs[2][1]],
  };
}

/** Push the optional adjustments common to RGB and single-band modes:
 * gamma → sigmoidal contrast. Both expect input clamped to 0..1, which the
 * preceding rescale module guarantees. */
function pushAdjustments(state: CogState, pipeline: RasterModule[]): void {
  if (state.gamma !== 1) {
    pipeline.push({ module: Gamma, props: { gamma: state.gamma } });
  }
  if (state.sigmoidal) {
    pipeline.push({
      module: Sigmoidal,
      props: { contrast: state.sigmoidal.contrast, bias: state.sigmoidal.bias },
    });
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
export function buildRgbCompositeRenderTile(state: CogState) {
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

    // Filter nodata BEFORE any rescale / gamma / sigmoidal so the comparison
    // happens against the texture's native sample value. User input is in
    // source units; divide by sampleScale to match what the GPU sees after
    // sampling (e.g. uint8 255 → 1.0 for r8unorm).
    const nodata = effectiveNodata(state, data.nodata);
    if (nodata !== null) {
      pipeline.push({
        module: FilterNoDataVal,
        props: { value: nodata / data.sampleScale },
      });
    }

    const perBand = effectivePerBandRescale(state);
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

    // Filter nodata BEFORE rescale / gamma / sigmoidal / colormap so the
    // comparison runs against the texture's native sample value, not a
    // colormapped or rescaled output. User input is source units; divide
    // by sampleScale to match the GPU's post-sampling value.
    const nodata = effectiveNodata(state, data.nodata);
    if (nodata !== null) {
      pipeline.push({
        module: FilterNoDataVal,
        props: { value: nodata / data.sampleScale },
      });
    }

    const rescale = effectiveRescale(state);
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
