import { describe, expect, it } from "vitest";
import { buildReprojectors } from "../reprojectors";

const fakeGeotiff = (overrides: Partial<{ crs: unknown; transform: number[] }>) => ({
  crs: 4326,
  transform: [1, 0, 0, 0, 1, 0],
  ...overrides,
}) as unknown as import("@developmentseed/geotiff").GeoTIFF;

describe("buildReprojectors", () => {
  it("returns identity-like fns for EPSG:4326 with identity transform", () => {
    const r = buildReprojectors(fakeGeotiff({ crs: 4326, transform: [1, 0, 0, 0, 1, 0] }));
    expect(r.forwardReproject(10, 20)).toEqual([10, 20]);
    expect(r.forwardTransform(3, 4)).toEqual([3, 4]);
    expect(r.inverseTransform(3, 4)).toEqual([3, 4]);
  });

  it("inverts a non-identity affine", () => {
    // Pixel→world: (0,0)→(100,200), pixel size 0.1
    const r = buildReprojectors(
      fakeGeotiff({ transform: [0.1, 0, 100, 0, -0.1, 200] }),
    );
    expect(r.forwardTransform(0, 0)).toEqual([100, 200]);
    const [u, v] = r.inverseTransform(100, 200);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(0);
  });

  it("throws on non-4326 CRS with a gdalwarp hint", () => {
    expect(() => buildReprojectors(fakeGeotiff({ crs: 3857 }))).toThrow(/gdalwarp/);
  });
});
