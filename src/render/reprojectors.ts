import type { GeoTIFF } from "@developmentseed/geotiff";
import type { RasterLayerProps } from "@developmentseed/deck.gl-raster";

export type ReprojectionFns = RasterLayerProps["reprojectionFns"];

/** Re-implementation of upstream `extractGeotiffReprojectors` that avoids
 * pulling in proj4 + @developmentseed/affine + raster-reproject. Handles
 * the common EPSG:4326 case (identity reprojection) and throws on
 * anything else, with a hint to convert via gdalwarp. */
export function buildReprojectors(geotiff: GeoTIFF): ReprojectionFns {
  // geotiff.crs is `number | ProjJson`. Treat 4326 (or any GCS WGS84
  // EPSG variant) as identity. Non-4326 strikes a corner we don't
  // support without proj4.
  const crs = geotiff.crs;
  if (typeof crs === "number" && crs !== 4326) {
    throw new Error(
      `Non-tiled GeoTIFF rendering requires CRS EPSG:4326 (got ${crs}). Convert with gdalwarp -t_srs EPSG:4326.`,
    );
  }
  if (typeof crs !== "number") {
    // ProjJson — we'd need proj4 to interpret. Fail loud.
    throw new Error(
      "Non-tiled GeoTIFF rendering requires EPSG:4326. The image's CRS is a non-EPSG ProjJson and is not supported.",
    );
  }

  const t = geotiff.transform as readonly [
    number, number, number, number, number, number,
  ];
  const inv = invertAffine(t);
  return {
    forwardTransform: (x, y) => applyAffine(t, x, y),
    inverseTransform: (x, y) => applyAffine(inv, x, y),
    // EPSG:4326 → EPSG:4326 is identity.
    forwardReproject: (x, y) => [x, y],
    inverseReproject: (x, y) => [x, y],
  };
}

type Affine = readonly [number, number, number, number, number, number];

function applyAffine(t: Affine, x: number, y: number): [number, number] {
  return [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
}

function invertAffine(t: Affine): Affine {
  const [a, b, c, d, e, f] = t;
  const det = a * e - b * d;
  return [
    e / det, -b / det, (b * f - c * e) / det,
    -d / det, a / det, (c * d - a * f) / det,
  ];
}
