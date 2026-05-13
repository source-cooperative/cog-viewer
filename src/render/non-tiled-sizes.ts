import { TiffTag } from "@cogeotiff/core";
import type { GeoTIFF } from "@developmentseed/geotiff";

/** Threshold above which we require the user to confirm "Load anyway". */
export const SIZE_GATE_BYTES = 64 * 1024 * 1024;

export type NonTiledSizes = {
  decodedBytes: number;
  diskBytes: number;
};

export type NonTiledSizeInputs = {
  width: number;
  height: number;
  samplesPerPixel: number;
  /** Uniform bits-per-sample across all bands. Stripped TIFFs with mixed
   * bitsPerSample are rejected upstream by the decoder. */
  bitsPerSample: number;
  /** Iterable of StripByteCounts values from the IFD. */
  stripByteCounts: Iterable<number>;
};

/** Decoded (uncompressed) + on-disk (compressed) sizes for a stripped
 * GeoTIFF. Both come from the IFD alone — no extra fetches. */
export function computeNonTiledSizes(input: NonTiledSizeInputs): NonTiledSizes {
  const decodedBytes =
    input.width *
    input.height *
    input.samplesPerPixel *
    Math.ceil(input.bitsPerSample / 8);
  let diskBytes = 0;
  for (const n of input.stripByteCounts) diskBytes += n;
  return { decodedBytes, diskBytes };
}

/** Whether the decoded and disk sizes differ enough to be worth showing
 * both in the warning. Compressed JPEG TIFFs commonly hit this. */
export function shouldShowBothSizes(a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi === 0) return false;
  if (lo === 0) return true;
  return hi / lo > 1.5;
}

/** Pull the IFD values needed to size a non-tiled image. Returns null
 * if the file lacks StripByteCounts (shouldn't happen on a valid
 * stripped TIFF, but better to bail than throw). */
export function extractGeoTiffSizeInputs(geotiff: GeoTIFF): NonTiledSizeInputs | null {
  const tag = geotiff.image.tags.get(TiffTag.StripByteCounts);
  if (!tag) return null;
  // tag.value can be number[], Uint16Array, or Uint32Array. Normalize
  // to a plain array so tests can deep-equal.
  const stripByteCounts = Array.from(tag.value as ArrayLike<number>);
  if (stripByteCounts.length === 0) return null;
  const raw = geotiff.cachedTags.bitsPerSample[0];
  const bitsPerSample = raw && raw > 0 ? raw : 8;
  return {
    width: geotiff.width,
    height: geotiff.height,
    samplesPerPixel: geotiff.count,
    bitsPerSample,
    stripByteCounts,
  };
}
