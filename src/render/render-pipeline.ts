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

    const rescale = effectiveRescale(state);
    if (rescale) {
      pipeline.push({
        module: LinearRescale,
        props: { rescaleMin: rescale[0], rescaleMax: rescale[1] },
      });
    }

    const nodata = effectiveNodata(state, data.nodata);
    if (nodata !== null) {
      pipeline.push({ module: FilterNoDataVal, props: { value: nodata } });
    }

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

    const rescale = effectiveRescale(state);
    if (rescale) {
      pipeline.push({
        module: LinearRescale,
        props: { rescaleMin: rescale[0], rescaleMax: rescale[1] },
      });
    }

    pipeline.push({
      module: Colormap,
      props: { colormapTexture, colormapIndex, reversed: false },
    });

    const nodata = effectiveNodata(state, data.nodata);
    if (nodata !== null) {
      pipeline.push({ module: FilterNoDataVal, props: { value: nodata } });
    }

    return { renderPipeline: pipeline };
  };
}
