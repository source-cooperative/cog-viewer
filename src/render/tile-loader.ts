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
  /** Pre-coercion CPU-side band arrays, keyed by 1-based band index as a
   * string. Retained alongside the GPU textures so the hover inspector
   * can read raw sample values without a re-fetch. Pre-coercion keeps the
   * smallest representation (u8/u16) and matches the COG's native dtype. */
  cpuBands: Map<string, RasterTypedArray>;
  width: number;
  height: number;
  byteLength: number;
  nodata: number | null;
  /**
   * Divisor that maps source-space sample values to the value the GPU
   * fragment shader actually reads for this tile's textures. For
   * `r8unorm` the GPU normalizes uint8 0..255 into 0..1, so source-unit
   * comparisons and rescale ranges (e.g. nodata=255, rescale=[0,255])
   * must be divided by 255 before being passed to a shader uniform.
   * For float formats (`r16float`, `r32float`) the value is uploaded as
   * a float and not normalized, so the divisor is 1.
   */
  sampleScale: number;
};

/**
 * Best-effort GPU-texture cleanup. `RasterTileLayer` doesn't surface
 * `onTileUnload`, so we can't deterministically destroy textures when
 * deck.gl evicts a tile. The next-best thing is a `FinalizationRegistry`
 * that fires when the tile data object is GC'd, which in practice happens
 * shortly after eviction. Unfreed textures leak GPU memory; the registry
 * bounds the leak instead of eliminating it.
 */
const tileFinalizer =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<Texture[]>((textures) => {
        for (const t of textures) {
          try {
            t.destroy();
          } catch {
            // best-effort
          }
        }
      })
    : null;

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

/** Divisor that converts source-unit sample values into the value the GPU
 * shader reads after sampling. See `MultiBandTileData.sampleScale`. */
function sampleScaleForFormat(format: TextureFormat): number {
  return format === "r8unorm" ? 255 : 1;
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
    const cpuBands = new Map<string, RasterTypedArray>();
    let totalBytes = 0;
    let sampleScale = 1;
    for (const idx of bandIndexes) {
      const i = idx - 1;
      if (i < 0 || i >= array.count) continue;
      const bandData: RasterTypedArray =
        array.layout === "band-separate"
          ? array.bands[i]
          : extractBand(array.data as RasterTypedArray, i, array.count);
      const format = singleBandFormat(bandData);
      const data = coerceForFormat(bandData, format);
      sampleScale = sampleScaleForFormat(format);
      const texture = device.createTexture({
        data,
        format,
        width: array.width,
        height: array.height,
      });
      bands.set(String(idx), { texture, uvTransform: IDENTITY_UV });
      cpuBands.set(String(idx), bandData);
      // Use the *post-coercion* per-element byte size so deck.gl's tile
      // cache budget reflects the actual buffer allocated. coerceForFormat
      // upcasts int16/uint16 to Float32 (4 bytes), which the older
      // bytesPerPixelSingle table reported as 2 bytes — under-counting.
      totalBytes += array.width * array.height * data.BYTES_PER_ELEMENT;
      // Account for the CPU copy too. For band-separate layout `bandData`
      // is a reference into the original array (shared), but the byte
      // budget is still a useful upper bound for cache eviction.
      totalBytes += bandData.byteLength;
    }
    const result: MultiBandTileData = {
      bands,
      cpuBands,
      width: array.width,
      height: array.height,
      byteLength: totalBytes,
      nodata: array.nodata,
      sampleScale,
    };
    if (tileFinalizer && bands.size > 0) {
      tileFinalizer.register(
        result,
        Array.from(bands.values(), (v) => v.texture),
      );
    }
    return result;
  };
}
