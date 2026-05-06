import { invert } from "@developmentseed/affine";
import type { GeoTIFF } from "@developmentseed/geotiff";
import proj4 from "proj4";

import type { Affine } from "@developmentseed/affine";

/** A function that converts WGS84 (lng, lat) into the COG's native CRS
 * coordinates (x, y). Returned by `lngLatToCogCrs`; null if the COG's CRS
 * couldn't be resolved by proj4. */
export type LngLatToCrs = (lng: number, lat: number) => [number, number];

/** Build a converter from WGS84 (lng, lat) to the COG's native CRS using
 * proj4. Returns null if the COG's CRS isn't an EPSG-coded projection
 * proj4 already knows. PROJJSON support could be added later. */
export function makeLngLatToCogCrs(tiff: GeoTIFF): LngLatToCrs | null {
  const crs = tiff.crs;
  // Numeric CRS = EPSG code.
  if (typeof crs === "number") {
    const code = `EPSG:${crs}`;
    try {
      // proj4 knows EPSG:4326, EPSG:3857, and a few others by default;
      // others throw "No projection definition for ...". Catching here so
      // the inspector can fall back gracefully.
      const fwd = proj4("EPSG:4326", code);
      return (lng, lat) => fwd.forward([lng, lat]) as [number, number];
    } catch {
      return null;
    }
  }
  // Non-EPSG (PROJJSON) CRSes aren't wired up here yet.
  return null;
}

/**
 * Apply the inverse of a tile's geotransform to convert CRS (x, y) to
 * pixel (col, row) within that tile.
 *
 * The Affine maps pixel → CRS as
 *   x = a*col + b*row + c
 *   y = d*col + e*row + f
 *
 * Inverting it gives a transform that maps CRS → pixel, which we then
 * apply to the input.
 */
export function crsToTilePixel(
  transform: Affine,
  x: number,
  y: number,
): [number, number] {
  const inv = invert(transform);
  const [a, b, c, d, e, f] = inv;
  return [a * x + b * y + c, d * x + e * y + f];
}
