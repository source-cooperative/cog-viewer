import { SourceCache, SourceChunk } from "@chunkd/middleware";
import { SourceView } from "@chunkd/source";
import { SourceHttp } from "@chunkd/source-http";
import { GeoTIFF } from "@developmentseed/geotiff";

/**
 * SourceHttp variant that resists the bogus `metadata.size` value the upstream
 * class records when the HTTP server returns 206 Partial Content but doesn't
 * expose `Content-Range` via CORS.
 *
 * Background. `getMetadataFromResponse` reads `content-length` first, then
 * overrides with `content-range` if present. `Content-Length` is a CORS-
 * safelisted response header (always readable from JS); `Content-Range` is
 * not. Many S3 buckets (and others) don't include
 * `Access-Control-Expose-Headers: Content-Range` in their CORS config, so
 * `response.headers.get("content-range")` returns null and `metadata.size`
 * gets stuck at `Content-Length` of the 206 — which is the chunk size, not
 * the file size.
 *
 * Downstream, `getMaxLength(offset, length)` clamps to `size - offset`. When
 * the IFD chain points past the assumed file end, that returns a NEGATIVE
 * length that propagates into a malformed `bytes=START-END` Range header
 * (end < start). S3 ignores the bad range and serves the entire file with
 * status 200. For NLCD that's a 1.4 GB download per page load.
 *
 * We can't repair `Content-Range` from the browser (CORS forbids it) and the
 * S3 bucket also blocks HEAD preflight. The least invasive fix: after each
 * fetch, if `metadata.size` was just initialised to a value equal to the
 * length we requested, treat it as bogus and clear it. With `size` unset,
 * `getMaxLength` returns the requested length unchanged and the chunk
 * middleware computes valid Range headers.
 *
 * Remove this once @developmentseed/geotiff (or @chunkd/source-http) lands a
 * fix for the underlying behavior.
 */
class CorsSafeSourceHttp extends SourceHttp {
  async fetch(
    offset: number,
    length?: number,
    options?: { signal: AbortSignal },
  ): Promise<ArrayBuffer> {
    const wasMetadata = this.metadata;
    const result = await super.fetch(offset, length, options);
    if (
      wasMetadata == null &&
      this.metadata != null &&
      length != null &&
      this.metadata.size === length
    ) {
      // Overwrite the in-place mutation done by the parent class. Cast away
      // the readonly-ish nature of metadata; we own this instance.
      (this.metadata as { size?: number }).size = undefined;
    }
    return result;
  }
}

const CHUNK_SIZE = 1024 * 1024;
const CACHE_SIZE = 10 * 1024 * 1024;

const inflight = new Map<string, Promise<GeoTIFF>>();

/**
 * Open a GeoTIFF from a URL. Equivalent to `GeoTIFF.fromUrl(url)` plus the
 * CORS workaround above. Dedupes concurrent requests for the same URL so
 * React StrictMode's double-effect doesn't kick off two parallel reads.
 */
export function loadGeoTIFF(url: string): Promise<GeoTIFF> {
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    const source = new CorsSafeSourceHttp(url, {});
    const view = new SourceView(source, [
      new SourceChunk({ size: CHUNK_SIZE }),
      new SourceCache({ size: CACHE_SIZE }),
    ]);
    return await GeoTIFF.open({
      dataSource: source,
      headerSource: view,
    });
  })();

  inflight.set(url, promise);
  promise.catch(() => inflight.delete(url));
  return promise;
}
