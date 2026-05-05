import type {
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  CreateTexture,
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { CogState } from "../state/types";
import type { TileTextureData } from "./tile-loader";

type Range = [number, number];

const RESCALE_EPSILON = 1e-9;
const safeRange = ([lo, hi]: Range): Range =>
  lo === hi ? [lo, lo + RESCALE_EPSILON] : [lo, hi];

/** Default rescale used when the user hasn't picked one and the COG dtype
 * suggests it. uint8 sources don't need a rescale; uint16 reflectance
 * (Sentinel-2-like) lands in roughly [0, 0.15] after r16unorm normalization. */
function defaultRescaleFor(_state: CogState): Range | null {
  return null;
}

function effectiveRescale(state: CogState): Range | null {
  if (state.rescale && state.rescale.length > 0) {
    return safeRange(state.rescale[0]);
  }
  return defaultRescaleFor(state);
}

function effectiveNodata(
  state: CogState,
  perTileNodata: number | null,
): number | null {
  if (state.nodata === "off") return null;
  if (typeof state.nodata === "number") return state.nodata;
  return perTileNodata;
}

export function buildRgbRenderTile(state: CogState) {
  return function renderTile(data: TileTextureData): RenderTileResult {
    const pipeline: RasterModule[] = [
      { module: CreateTexture, props: { textureName: data.texture } },
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
