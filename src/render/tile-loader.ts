import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { GeoTIFF, Overview, RasterArray, RasterTypedArray } from "@developmentseed/geotiff";
import type { TextureFormat } from "@luma.gl/core";
import type { Texture } from "@luma.gl/core";

type Order = [number | null, number | null, number | null, number | null];

/**
 * Pack selected source bands into a pixel-interleaved RGBA typed array.
 * Inlined here because @developmentseed/geotiff doesn't re-export
 * `packBandsToRGBA` from its package entry as of 0.6.1.
 */
function packBandsToRGBA(
  array: RasterArray,
  order: Order,
  fillValue = 0,
): { data: RasterTypedArray; width: number; height: number } {
  const { width, height, count } = array;
  const pixels = width * height;
  const firstBand: RasterTypedArray =
    array.layout === "band-separate" ? array.bands[0] : array.data;
  const Ctor = firstBand.constructor as new (
    length: number,
  ) => RasterTypedArray;
  const out = new Ctor(pixels * 4);
  if (fillValue !== 0) out.fill(fillValue as number);

  const sampleAt =
    array.layout === "band-separate"
      ? (band: number, i: number) =>
          (array.bands[band] as RasterTypedArray)[i] as number
      : (band: number, i: number) =>
          (array.data as RasterTypedArray)[i * count + band] as number;

  for (let ch = 0; ch < 4; ch++) {
    const src = order[ch];
    if (src === null || src === undefined || src < 0 || src >= count) continue;
    for (let i = 0; i < pixels; i++) {
      out[i * 4 + ch] = sampleAt(src, i);
    }
  }

  // Fill alpha with the max value for this dtype so the texture is opaque
  // (rgba8unorm → 255 maps to 1.0; floats → 1.0 directly).
  if (order[3] === null || order[3] === undefined) {
    const opaque =
      out instanceof Uint8Array || out instanceof Uint8ClampedArray ? 255 :
      out instanceof Uint16Array ? 65535 :
      out instanceof Int8Array ? 127 :
      out instanceof Int16Array ? 32767 :
      1;
    for (let i = 0; i < pixels; i++) out[i * 4 + 3] = opaque;
  }
  return { data: out, width, height };
}

export type TileTextureData = {
  texture: Texture;
  width: number;
  height: number;
  byteLength: number;
  /** Nodata value declared by the COG, surfaced so the renderTile pipeline
   * can route it into FilterNoDataVal. */
  nodata: number | null;
};

/** Pick a texture format based on the source TypedArray. We only support the
 * common COG dtypes; anything else falls back to rgba8unorm with implicit
 * truncation, which the viewer surfaces as visibly broken so the user can
 * route around it. */
function rgbaFormat(data: RasterTypedArray): TextureFormat {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    return "rgba8unorm";
  }
  if (data instanceof Uint16Array || data instanceof Int16Array) {
    return "rgba16float";
  }
  if (data instanceof Float32Array) {
    return "rgba32float";
  }
  return "rgba8unorm";
}

function bytesPerPixelRGBA(format: TextureFormat): number {
  switch (format) {
    case "rgba16float":
      return 8;
    case "rgba32float":
      return 16;
    default:
      return 4;
  }
}

/** Convert int16/uint16 to Float32 for upload as rgba16float. luma.gl/WebGPU
 * does not support direct upload of integer data into float-typed textures. */
function coerceForFormat(
  array: RasterTypedArray,
  format: TextureFormat,
): RasterTypedArray {
  if (format === "rgba16float" || format === "rgba32float") {
    if (array instanceof Float32Array) return array;
    if (array instanceof Uint16Array || array instanceof Int16Array) {
      const out = new Float32Array(array.length);
      for (let i = 0; i < array.length; i++) out[i] = array[i];
      return out;
    }
  }
  return array;
}

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

/**
 * Build a getTileData callback for a single-band COG (or one user-selected
 * band of a multi-band COG). Uploads as an `r*` texture; the renderTile
 * pipeline broadcasts the red channel into RGB via `BlackIsZero` and applies
 * a colormap on top.
 */
export function makeSingleTileLoader(bandIndex: number) {
  return async function getTileData(
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ): Promise<TileTextureData> {
    const { device, x, y, signal } = options;
    const tile = await image.fetchTile(x, y, { signal, boundless: false });
    const array: RasterArray = tile.array;
    const idx = bandIndex - 1;
    const bandData: RasterTypedArray =
      array.layout === "band-separate"
        ? (array.bands[idx] ?? array.bands[0])
        : extractBand(array.data as RasterTypedArray, idx, array.count);
    const format = singleBandFormat(bandData);
    const data = coerceForFormat(bandData, format);
    const texture = device.createTexture({
      data,
      format,
      width: array.width,
      height: array.height,
    });
    return {
      texture,
      width: array.width,
      height: array.height,
      byteLength: array.width * array.height * bytesPerPixelSingle(format),
      nodata: array.nodata,
    };
  };
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
 * Build a getTileData callback for a multi-band COG that packs user-chosen
 * band indexes into an RGBA texture.
 *
 * `bands` is 1-indexed (TIFF convention) and accepts 1–3 entries. Channels
 * not provided default to 0; the alpha channel is filled with the maximum
 * value for the format so the texture is fully opaque.
 */
export function makeRgbaTileLoader(bands: number[]) {
  return async function getTileData(
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ): Promise<TileTextureData> {
    const { device, x, y, signal } = options;
    const tile = await image.fetchTile(x, y, { signal, boundless: false });
    const array: RasterArray = tile.array;
    const order: Order = [
      bands[0] != null ? bands[0] - 1 : null,
      bands[1] != null ? bands[1] - 1 : null,
      bands[2] != null ? bands[2] - 1 : null,
      null,
    ];
    const packed = packBandsToRGBA(array, order, 0);
    const format = rgbaFormat(packed.data);
    const data = coerceForFormat(packed.data, format);
    const texture = device.createTexture({
      data,
      format,
      width: packed.width,
      height: packed.height,
    });
    return {
      texture,
      width: packed.width,
      height: packed.height,
      byteLength: packed.width * packed.height * bytesPerPixelRGBA(format),
      nodata: array.nodata,
    };
  };
}
