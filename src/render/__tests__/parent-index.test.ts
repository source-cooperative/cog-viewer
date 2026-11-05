import { RasterTileset2D } from "@developmentseed/deck.gl-raster";
import { describe, expect, it } from "vitest";

// Guards our patch to RasterTileset2D.getParentIndex (patches/@developmentseed__deck.gl-raster@0.9.0.patch).
const parentOf = (levels: object[], index: { x: number; y: number; z: number }) =>
  (RasterTileset2D.prototype.getParentIndex as (i: typeof index) => typeof index).call(
    { descriptor: { levels } },
    index,
  );
const lvl = (metersPerPixel: number) => ({ metersPerPixel, tileWidth: 512, tileHeight: 512 });

describe("RasterTileset2D.getParentIndex", () => {
  it("picks the covering parent when rounded-down overviews make decimation slightly > 2", () => {
    // From wrc-2-pa-buildingcount-conus-cog.tif: 771 px -> 1543 px overview.
    const levels = [lvl(9290.83208065567), lvl(4643.910476833317)];
    expect(parentOf(levels, { x: 2, y: 0, z: 1 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(parentOf(levels, { x: 3, y: 1, z: 1 })).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("is exact for integer decimation", () => {
    expect(parentOf([lvl(20), lvl(10)], { x: 5, y: 4, z: 1 })).toEqual({ x: 2, y: 2, z: 0 });
    expect(parentOf([lvl(10), lvl(10)], { x: 5, y: 4, z: 1 })).toEqual({ x: 5, y: 4, z: 0 });
  });
});
