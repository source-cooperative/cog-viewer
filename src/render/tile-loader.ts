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

/**
 * Module-level reporter for tile fetch/decode failures. `getTileData` is
 * created once at module scope (App keeps its identity stable so deck.gl's
 * TileLayer doesn't invalidate its cache), so it can't close over React's
 * `setError`. Instead the app registers a handler here — mirroring the
 * module-scope `SourceHttp.fetch` override in load-geotiff.ts.
 *
 * Without this, a COG that opens fine but fails per-tile (unsupported
 * compression, corrupt tiles, a non-tiled TIFF that slipped past validation)
 * shows a blank map with no explanation: the rejection is swallowed by deck.gl.
 */
let tileErrorHandler: ((err: unknown) => void) | null = null;
export function setTileErrorHandler(fn: ((err: unknown) => void) | null): void {
  tileErrorHandler = fn;
}

/** AbortErrors are normal — deck.gl cancels in-flight tiles on pan/zoom.
 * @chunkd/source-http wraps ALL errors in its own `SourceError` class
 * (including `AbortError`) — the original DOMException ends up on `err.cause`
 * via Error's native cause chaining. Check both the error itself and its cause
 * so wrapped aborts aren't mistaken for real failures. */
function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    const { cause } = err;
    if (cause instanceof DOMException && cause.name === "AbortError") return true;
  }
  return false;
}

export type MultiBandTileData = {
  /** One r-channel texture per fetched band, keyed by 1-based band index
   * as a string so it can flow into `buildCompositeBandsProps`. */
  bands: Map<string, { texture: Texture; uvTransform: UvTransform }>;
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
   * For `r16float` / `r32float` the value is uploaded as (or as an
   * encoding of) the original source float, so the divisor is 1.
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
  // Anything else → r32float. Full precision; the right answer for
  // both float COGs and integer-encoded reflectance/elevation. We
  // briefly tried r16float via JS-side half-float encoding to halve
  // GPU memory but the precision rounding broke nodata equality
  // (encoded -9999 ≠ uniform -9999) and quantized values too coarsely
  // for accurate rescale on data spanning > 2048 in magnitude.
  return "r32float";
}

/** Divisor that converts source-unit sample values into the value the GPU
 * shader reads after sampling. See `MultiBandTileData.sampleScale`. */
function sampleScaleForFormat(format: TextureFormat): number {
  return format === "r8unorm" ? 255 : 1;
}

/** Cast non-Float32 source data to Float32 for upload into r32float
 * textures. r8unorm passes Uint8Array straight through. */
function coerceForFormat(
  array: RasterTypedArray,
  format: TextureFormat,
): RasterTypedArray {
  if (format !== "r32float") return array;
  if (array instanceof Float32Array) return array;
  return Float32Array.from(array);
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
    try {
      const tile = await image.fetchTile(x, y, { signal, boundless: false });
      const array: RasterArray = tile.array;
      const bands = new Map<
        string,
        { texture: Texture; uvTransform: UvTransform }
      >();
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
        // Use the *post-coercion* per-element byte size so deck.gl's tile
        // cache budget reflects the actual buffer allocated. coerceForFormat
        // upcasts int16/uint16 to Float32 (4 bytes).
        totalBytes += array.width * array.height * data.BYTES_PER_ELEMENT;
      }
      const result: MultiBandTileData = {
        bands,
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
    } catch (err) {
      // Aborts are routine (pan/zoom cancels in-flight tiles) — let them
      // propagate untouched. Any other failure is a real render error the
      // user should see; report it, then re-throw so deck.gl still marks the
      // tile failed rather than caching a broken result.
      if (!isAbortError(err)) tileErrorHandler?.(err);
      throw err;
    }
  };
}
