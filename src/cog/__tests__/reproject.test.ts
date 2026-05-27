import type { GeoTIFF } from "@developmentseed/geotiff";
import type { ProjectionDefinition } from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { describe, expect, it } from "vitest";
import { buildReprojectionFns, geographicBounds } from "../reproject";

/** Affine mapping pixel (col,row) → CRS: origin (100, 200), 2-unit pixels,
 * y decreasing downward. x = 2·col + 100; y = -2·row + 200. */
const TRANSFORM = [2, 0, 100, 0, -2, 200] as const;

function fakeGeoTIFF(
  overrides: Partial<Pick<GeoTIFF, "transform" | "bbox">>,
): GeoTIFF {
  return {
    transform: TRANSFORM,
    bbox: [0, 0, 10, 20] as [number, number, number, number],
    ...overrides,
  } as unknown as GeoTIFF;
}

// EPSG:4326 is built into proj4, so source→4326 is the identity and we can
// isolate the affine pixel↔CRS behaviour from the projection maths.
const IDENTITY_4326 = "EPSG:4326" as unknown as ProjectionDefinition;

describe("buildReprojectionFns", () => {
  it("maps pixel coordinates to CRS via the affine geotransform", () => {
    const fns = buildReprojectionFns(fakeGeoTIFF({}), IDENTITY_4326);
    expect(fns.forwardTransform(0, 0)).toEqual([100, 200]);
    expect(fns.forwardTransform(1, 0)).toEqual([102, 200]);
    expect(fns.forwardTransform(0, 1)).toEqual([100, 198]);
  });

  it("inverseTransform round-trips forwardTransform", () => {
    const fns = buildReprojectionFns(fakeGeoTIFF({}), IDENTITY_4326);
    const [x, y] = fns.forwardTransform(7, 3);
    const [col, row] = fns.inverseTransform(x, y);
    expect(col).toBeCloseTo(7, 10);
    expect(row).toBeCloseTo(3, 10);
  });

  it("reprojects identically when source CRS is EPSG:4326", () => {
    const fns = buildReprojectionFns(fakeGeoTIFF({}), IDENTITY_4326);
    const [lon, lat] = fns.forwardReproject(12.5, 41.9);
    expect(lon).toBeCloseTo(12.5, 9);
    expect(lat).toBeCloseTo(41.9, 9);
  });
});

describe("geographicBounds", () => {
  it("takes the envelope of the reprojected bbox corners", () => {
    // Reproject halves the source coordinates so the math is easy to check.
    const fns: ReprojectionFns = {
      forwardTransform: (x, y) => [x, y],
      inverseTransform: (x, y) => [x, y],
      forwardReproject: (x, y) => [x / 2, y / 2],
      inverseReproject: (x, y) => [x * 2, y * 2],
    };
    const bounds = geographicBounds(
      fakeGeoTIFF({ bbox: [0, 0, 10, 20] }),
      fns,
    );
    expect(bounds).toEqual({ west: 0, south: 0, east: 5, north: 10 });
  });
});
