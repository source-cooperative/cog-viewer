import type { GeoTIFF } from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import {
  applyCrsRescue,
  crsOverrideLabel,
  rescueCrsDef,
  rescuingEpsgResolver,
} from "../crs-rescue";

// GeoKeys mirroring the real Colombia "World Cylindrical Equal Area" COG that
// triggered the crash: ProjCoordTrans (3075) = 28, WGS 84 ellipsoid, all
// projection parameters zero.
const CEA_GKD = {
  projMethod: 28,
  projStdParallel1: 0,
  projNatOriginLong: 0,
  projFalseEasting: 0,
  projFalseNorthing: 0,
  ellipsoidSemiMajorAxis: 6378137,
  ellipsoidInvFlattening: 298.257223563,
  ellipsoidSemiMinorAxis: null,
  projectedCitation: null,
  citation: "World_Cylindrical_Equal_Area",
};

/** Build a minimal GeoTIFF-shaped stub carrying just the geo keys we read. */
const fakeTiff = (gkd: object): GeoTIFF => ({ gkd }) as unknown as GeoTIFF;
const crsOf = (tiff: GeoTIFF): number | undefined =>
  (tiff as unknown as { _crs?: number })._crs;

describe("rescueCrsDef", () => {
  it("builds a proj4 cea definition for ProjCoordTrans 28", () => {
    const rescued = rescueCrsDef(CEA_GKD);
    expect(rescued).not.toBeNull();
    expect(rescued?.def.projName).toBe("cea");
    // The lat_ts patch is the crux: without it proj4's cea.js collapses every
    // coordinate to NaN because the standard parallel is left undefined.
    expect(Number.isFinite(rescued?.def.lat_ts)).toBe(true);
    expect(rescued?.def.units).toBe("meter");
    expect(rescued?.def.a).toBeCloseTo(6378137, 0);
    expect(rescued?.label).toBe("World_Cylindrical_Equal_Area");
  });

  it("carries a non-zero standard parallel into lat_ts (radians)", () => {
    const rescued = rescueCrsDef({ ...CEA_GKD, projStdParallel1: 30 });
    // wkt-parser converts degrees to radians; 30° ≈ π/6.
    expect(rescued?.def.lat_ts).toBeCloseTo(Math.PI / 6, 5);
  });

  it("defaults to the WGS 84 ellipsoid when ellipsoid keys are absent", () => {
    const rescued = rescueCrsDef({ projMethod: 28, citation: "CEA" });
    expect(rescued?.def.projName).toBe("cea");
    expect(rescued?.def.a).toBeCloseTo(6378137, 0);
    expect(rescued?.label).toBe("CEA");
  });

  it("returns null for projections it doesn't rescue", () => {
    expect(rescueCrsDef({ projMethod: 1 })).toBeNull(); // Transverse Mercator
    expect(rescueCrsDef({ projMethod: null })).toBeNull();
    expect(rescueCrsDef({})).toBeNull();
  });
});

describe("applyCrsRescue + rescuingEpsgResolver", () => {
  it("seeds a sentinel code and resolves it to the cea definition", async () => {
    const tiff = fakeTiff({ ...CEA_GKD });
    expect(applyCrsRescue(tiff)).toBe(true);
    const code = crsOf(tiff);
    expect(typeof code).toBe("number");
    expect(code as number).toBeGreaterThanOrEqual(100_000_000);
    const def = await rescuingEpsgResolver(code as number);
    expect(def.projName).toBe("cea");
    expect(crsOverrideLabel(code as number)).toBe("World_Cylindrical_Equal_Area");
  });

  it("reuses one sentinel code for identical CRSes", () => {
    const a = fakeTiff({ ...CEA_GKD });
    const b = fakeTiff({ ...CEA_GKD });
    applyCrsRescue(a);
    applyCrsRescue(b);
    expect(crsOf(a)).toBe(crsOf(b));
  });

  it("leaves non-rescuable tiffs untouched", () => {
    const tiff = fakeTiff({ projMethod: 1 });
    expect(applyCrsRescue(tiff)).toBe(false);
    expect(crsOf(tiff)).toBeUndefined();
  });

  it("returns null label for codes that aren't overrides", () => {
    expect(crsOverrideLabel(3857)).toBeNull();
  });
});
