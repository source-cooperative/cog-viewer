import type { GeoTIFF, RasterTypedArray } from "@developmentseed/geotiff";
import type { Device, Texture, TextureFormat } from "@luma.gl/core";
import { decodeStrips } from "./decode-strips";
import { MAX_BAND_SLOTS, type MultiBandTileData } from "./tile-loader";

const IDENTITY_UV: [number, number, number, number] = [0, 0, 1, 1];

export type NonTiledRaster = {
  data: MultiBandTileData;
  width: number;
  height: number;
};

/**
 * Decode every strip of a stripped GeoTIFF, upload the requested band
 * indexes (1-based) as r-channel textures, and return a whole-image
 * `MultiBandTileData` ready for the existing render pipeline.
 *
 * Caller is responsible for keeping `bandIndexes.length <=
 * MAX_BAND_SLOTS`. Indexes beyond the actual band count are silently
 * skipped (matches `tile-loader.ts`).
 */
export async function loadNonTiled(
  geotiff: GeoTIFF,
  bandIndexes: number[],
  device: Device,
  signal: AbortSignal,
): Promise<NonTiledRaster> {
  const decoded = await decodeStrips(geotiff, { signal });
  if (signal.aborted) {
    throw new DOMException("loadNonTiled aborted", "AbortError");
  }

  const bands = new Map<
    string,
    { texture: Texture; uvTransform: typeof IDENTITY_UV }
  >();
  let totalBytes = 0;
  let sampleScale = 1;

  for (const idx of bandIndexes.slice(0, MAX_BAND_SLOTS)) {
    const i = idx - 1;
    if (i < 0 || i >= decoded.samplesPerPixel) continue;
    const bandData = decoded.bands[i];
    const format = singleBandFormat(bandData);
    const data = coerceForFormat(bandData, format);
    sampleScale = format === "r8unorm" ? 255 : 1;
    const texture = device.createTexture({
      data,
      format,
      width: decoded.width,
      height: decoded.height,
    });
    bands.set(String(idx), { texture, uvTransform: IDENTITY_UV });
    totalBytes += decoded.width * decoded.height * data.BYTES_PER_ELEMENT;
  }

  return {
    data: {
      bands,
      width: decoded.width,
      height: decoded.height,
      byteLength: totalBytes,
      nodata: decoded.nodata,
      sampleScale,
    },
    width: decoded.width,
    height: decoded.height,
  };
}

// Local copies of the format helpers from tile-loader.ts. Keeping them
// in-place avoids a refactor of the existing path (and the impossibility
// of unit-testing GPU-touching code in JSDOM).
function singleBandFormat(data: RasterTypedArray): TextureFormat {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    return "r8unorm";
  }
  return "r32float";
}

function coerceForFormat(
  array: RasterTypedArray,
  format: TextureFormat,
): RasterTypedArray {
  if (format !== "r32float") return array;
  if (array instanceof Float32Array) return array;
  return Float32Array.from(array);
}
