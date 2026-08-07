import type { GeoTIFF } from "@developmentseed/geotiff";

/** Result of {@link validateCog}: an `error` blocks rendering, a `warning` is
 * informational (render still proceeds), and `null` means the COG looks fine. */
export type CogValidation =
  | { level: "error"; message: string }
  | { level: "warning"; message: string }
  | null;

/** Structural subset of `GeoTIFF` we inspect. Lets tests pass plain stubs
 * without constructing a real `GeoTIFF` (mirrors metadata.ts's `MetadataInput`).
 *
 * We deliberately use only `image.isTiled()` — it returns a boolean and never
 * throws. `tiff.tileWidth`/`tileHeight`/`tileCount`/`fetchTile` all dereference
 * `image.tileSize`, which THROWS `"Tiff is not tiled"` on a striped file, so
 * they must never be touched before this check passes. */
type ValidateInput = {
  image: Pick<GeoTIFF["image"], "isTiled">;
  overviews: readonly unknown[];
};

/**
 * Check whether an opened GeoTIFF can actually be streamed as a Cloud
 * Optimized GeoTIFF. Pure — no fetches, no I/O.
 *
 * A striped (non-tiled) TIFF is not a COG: the deck.gl tile pipeline calls
 * `fetchTile(x, y)`, which throws `"Tiff is not tiled"` on such a file, and
 * there's no random-access / overview path to fall back on. We reject it up
 * front with an actionable message instead of letting every tile silently fail.
 *
 * A tiled COG with no overviews still renders, but low-zoom views must read
 * full-resolution tiles, so we surface a non-blocking warning.
 */
export function validateCog(tiff: ValidateInput): CogValidation {
  if (!tiff.image.isTiled()) {
    return {
      level: "error",
      message:
        "This GeoTIFF is stored in strips, not internal tiles — it isn't a " +
        "Cloud Optimized GeoTIFF, so the viewer can't stream it. Re-encode it " +
        "as a COG with internal tiling and overviews (e.g. `rio cogeo create` " +
        "or `gdal_translate -of COG`).",
    };
  }
  if (tiff.overviews.length === 0) {
    return {
      level: "warning",
      message:
        "This COG has no overviews, so zoomed-out views may load slowly.",
    };
  }
  return null;
}
