import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type {
  GeoTIFF,
  Overview,
  RasterArray,
  RasterTypedArray,
} from "@developmentseed/geotiff";
import type { Texture, TextureFormat } from "@luma.gl/core";

/** Mirrors `MAX_BAND_SLOTS` in deck.gl-raster's `composite-bands.ts`, which
 * isn't re-exported from the package entry. The CompositeBands shader has
 * 4 fixed band texture slots. */
export const MAX_BAND_SLOTS = 4;

/** UV transform vec4 = (offsetX, offsetY, scaleX, scaleY). Identity since
 * we never reproject within a tile. */
type UvTransform = [number, number, number, number];
const IDENTITY_UV: UvTransform = [0, 0, 1, 1];

export type MultiBandTileData = {
  /** One r-channel texture per fetched band, keyed by 1-based band index
   * as a string so it can flow into `buildCompositeBandsProps`. */
  bands: Map<string, { texture: Texture; uvTransform: UvTransform }>;
  width: number;
  height: number;
  byteLength: number;
  nodata: number | null;
};

function singleBandFormat(data: RasterTypedArray): TextureFormat {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    return "r8unorm";
  }
  if (data instanceof Uint16Array || data instanceof Int16Array) {
    return "r16float";
  }
  if (data instanceof Float32Array) {
    return "r32float";
  }
  return "r8unorm";
}

function bytesPerPixelSingle(format: TextureFormat): number {
  switch (format) {
    case "r16float":
      return 2;
    case "r32float":
      return 4;
    default:
      return 1;
  }
}

/** WebGPU/luma can't upload integer typed arrays into float texture formats;
 * cast to Float32 when the format demands it. */
function coerceForFormat(
  array: RasterTypedArray,
  format: TextureFormat,
): RasterTypedArray {
  if (format === "r16float" || format === "r32float") {
    if (array instanceof Float32Array) return array;
    if (array instanceof Uint16Array || array instanceof Int16Array) {
      const out = new Float32Array(array.length);
      for (let i = 0; i < array.length; i++) out[i] = array[i];
      return out;
    }
  }
  return array;
}

function extractBand(
  data: RasterTypedArray,
  band: number,
  count: number,
): RasterTypedArray {
  const pixels = data.length / count;
  const Ctor = data.constructor as new (length: number) => RasterTypedArray;
  const out = new Ctor(pixels);
  for (let i = 0; i < pixels; i++) {
    out[i] = data[i * count + band] as number;
  }
  return out;
}

/**
 * Build a getTileData callback that fetches the COG tile once and uploads
 * each band in `bandIndexes` (1-indexed) as its own r-channel texture.
 * Render pipelines can then swizzle channels via `CompositeBands` without
 * a re-fetch.
 *
 * The CompositeBands shader has {@link MAX_BAND_SLOTS} fixed slots, so the
 * caller is responsible for keeping `bandIndexes.length <= MAX_BAND_SLOTS`.
 * Indexes that exceed the COG's actual band count are silently skipped.
 */
export function makeMultiBandTileLoader(bandIndexes: number[]) {
  return async function getTileData(
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ): Promise<MultiBandTileData> {
    const { device, x, y, signal } = options;
    const tile = await image.fetchTile(x, y, { signal, boundless: false });
    const array: RasterArray = tile.array;
    const bands = new Map<
      string,
      { texture: Texture; uvTransform: UvTransform }
    >();
    let totalBytes = 0;
    for (const idx of bandIndexes) {
      const i = idx - 1;
      if (i < 0 || i >= array.count) continue;
      const bandData: RasterTypedArray =
        array.layout === "band-separate"
          ? array.bands[i]
          : extractBand(array.data as RasterTypedArray, i, array.count);
      const format = singleBandFormat(bandData);
      const data = coerceForFormat(bandData, format);
      const texture = device.createTexture({
        data,
        format,
        width: array.width,
        height: array.height,
      });
      bands.set(String(idx), { texture, uvTransform: IDENTITY_UV });
      totalBytes += array.width * array.height * bytesPerPixelSingle(format);
    }
    return {
      bands,
      width: array.width,
      height: array.height,
      byteLength: totalBytes,
      nodata: array.nodata,
    };
  };
}
