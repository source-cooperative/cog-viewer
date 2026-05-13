/** Threshold above which we require the user to confirm "Load anyway". */
export const SIZE_GATE_BYTES = 64 * 1024 * 1024;

export type NonTiledSizes = {
  decodedBytes: number;
  diskBytes: number;
};

type Input = {
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
export function computeNonTiledSizes(input: Input): NonTiledSizes {
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
