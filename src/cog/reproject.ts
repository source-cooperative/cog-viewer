import * as affine from "@developmentseed/affine";
import type { GeoTIFF } from "@developmentseed/geotiff";
import {
  epsgResolver,
  parseWkt,
  type ProjectionDefinition,
} from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";

export type GeographicBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * Resolve the source projection from a GeoTIFF's CRS. Numeric EPSG codes go
 * through the epsg.io-backed resolver; user-defined CRSes arrive as PROJJSON
 * and are parsed directly. Mirrors the branch in COGLayer's `_parseGeoTIFF`.
 */
export async function resolveSourceProjection(
  geotiff: GeoTIFF,
): Promise<ProjectionDefinition> {
  const crs = geotiff.crs;
  return typeof crs === "number" ? await epsgResolver(crs) : parseWkt(crs);
}

/**
 * Build the pixel↔CRS↔WGS84 functions that {@link RasterLayer} needs.
 *
 * Replicates the (intentionally non-exported) `extractGeotiffReprojectors` /
 * `fromAffine` helpers in `@developmentseed/deck.gl-geotiff`:
 *
 * - `forwardTransform` / `inverseTransform` map pixel `(col, row)` ↔ source-CRS
 *   coordinates via the image's affine geotransform. `RasterReprojector` scales
 *   its UV samples up by `(width-1, height-1)` *before* calling
 *   `forwardTransform`, so this receives pixel coordinates, not UV — which is
 *   exactly what `geotiff.transform` consumes.
 * - `forwardReproject` / `inverseReproject` map source CRS ↔ EPSG:4326 via proj4.
 *
 * TODO(#573): remove once `@developmentseed/geotiff` supports reading
 * single-tile / stripped images and the whole-file path is retired.
 */
export function buildReprojectionFns(
  geotiff: GeoTIFF,
  sourceProjection: ProjectionDefinition,
): ReprojectionFns {
  // @ts-expect-error proj4's types don't model wkt-parser / ProjectionDefinition
  // input objects, only proj strings.
  const converter = proj4(sourceProjection, "EPSG:4326");
  const geotransform = geotiff.transform;
  const inverseGeotransform = affine.invert(geotransform);

  return {
    forwardTransform: (x, y) => affine.apply(geotransform, x, y),
    inverseTransform: (x, y) => affine.apply(inverseGeotransform, x, y),
    forwardReproject: (x, y) => converter.forward([x, y], false),
    inverseReproject: (x, y) => converter.inverse([x, y], false),
  };
}

/**
 * WGS84 envelope of the image, derived by reprojecting the four source-CRS
 * bbox corners. Adequate for `fitBounds`; not a densified edge sample, so it
 * can slightly under-cover extents in strongly curved projections.
 */
export function geographicBounds(
  geotiff: GeoTIFF,
  fns: ReprojectionFns,
): GeographicBounds {
  const [minX, minY, maxX, maxY] = geotiff.bbox;
  const corners: [number, number][] = [
    [minX, minY],
    [minX, maxY],
    [maxX, minY],
    [maxX, maxY],
  ].map(([x, y]) => fns.forwardReproject(x, y));

  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}
