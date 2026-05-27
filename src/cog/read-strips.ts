import type { RasterTypedArray } from "@developmentseed/geotiff";
import { fromArrayBuffer } from "geotiff";

/**
 * A whole image read into memory, one band-separate typed array per band.
 *
 * Produced by {@link readWholeImage} for stripped (non-tiled) TIFFs, which
 * `@developmentseed/geotiff` can't read tile-by-tile. Mirrors the shape the
 * tile path's per-band texture builder expects.
 */
export type WholeImage = {
  width: number;
  height: number;
  bandCount: number;
  /** One typed array per band, in band order (0-based index = band − 1). */
  bands: RasterTypedArray[];
};

/**
 * Largest texture dimension we'll attempt. deck.gl uploads one texture per band
 * at full image size; WebGL2's guaranteed floor for `MAX_TEXTURE_SIZE` is
 * 2048, but every target we support reports ≥ 8192. Beyond this we bail rather
 * than risk an upload failure with no recovery.
 */
export const MAX_TEXTURE_DIMENSION = 8192;

/**
 * Cap on total decoded samples (width × height × bands) to bound the whole-file
 * download + in-memory decode. ~64M samples ≈ 256 MB at 4 bytes/sample.
 */
export const MAX_TOTAL_SAMPLES = 64 * 1024 * 1024;

/**
 * Reason a non-tiled image can't be rendered whole, or null if it can. Callers
 * check this against already-loaded metadata *before* fetching pixels, so a
 * huge stripped file never gets downloaded.
 */
export function tooLargeReason(
  width: number,
  height: number,
  bandCount: number,
): string | null {
  if (width > MAX_TEXTURE_DIMENSION || height > MAX_TEXTURE_DIMENSION) {
    return `image is ${width}×${height}px; non-tiled rendering is limited to ${MAX_TEXTURE_DIMENSION}px per side`;
  }
  if (width * height * bandCount > MAX_TOTAL_SAMPLES) {
    return "image is too large to read into memory as a whole file";
  }
  return null;
}

/**
 * Read an entire (typically stripped/non-tiled) TIFF into memory with
 * geotiff.js, returning one typed array per band.
 *
 * We fetch the whole file as an ArrayBuffer ourselves — reusing the
 * `cache: "no-store"` convention from {@link file://./load-geotiff.ts} — and
 * hand it to geotiff.js `fromArrayBuffer`. For a stripped image `readRasters`
 * reads (nearly) the whole file regardless, so a single up-front download is
 * both simplest and avoids geotiff.js's own HTTP range path (which hits the
 * same CORS `Content-Range` pitfall worked around in load-geotiff.ts).
 *
 * geotiff.js reads stripped *and* tiled layouts, so this also works as a
 * fallback for tiled images, though the app only routes non-tiled ones here.
 *
 * TODO(#573): drop this module once `@developmentseed/geotiff` supports reading
 * single-tile / stripped images directly via `fetchTile`.
 */
export async function readWholeImage(
  url: string,
  signal?: AbortSignal,
): Promise<WholeImage> {
  const resp = await fetch(url, { cache: "no-store", signal });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  const buffer = await resp.arrayBuffer();
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bandCount = image.getSamplesPerPixel();

  const reason = tooLargeReason(width, height, bandCount);
  if (reason) throw new Error(reason);

  // interleave: false → one typed array per sample/band, in band order.
  const rasters = await image.readRasters({ interleave: false, signal });
  const bands = rasters as unknown as RasterTypedArray[];

  return { width, height, bandCount, bands };
}
