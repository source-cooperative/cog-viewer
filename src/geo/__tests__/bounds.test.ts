import { describe, expect, it } from "vitest";
import { isValidGeographicBounds } from "../bounds";

describe("isValidGeographicBounds", () => {
  it("accepts a normal geographic bounding box", () => {
    expect(
      isValidGeographicBounds({ west: -10, south: 40, east: 5, north: 55 }),
    ).toBe(true);
  });

  it("rejects a latitude outside -90..90 (e.g. unreprojected projected-CRS metres)", () => {
    expect(
      isValidGeographicBounds({
        west: 500000,
        south: 4500000,
        east: 600000,
        north: 4600000,
      }),
    ).toBe(false);
  });

  it("rejects longitudes outside -180..180", () => {
    expect(
      isValidGeographicBounds({ west: -181, south: 40, east: 5, north: 55 }),
    ).toBe(false);
    expect(
      isValidGeographicBounds({ west: -10, south: 40, east: 181, north: 55 }),
    ).toBe(false);
  });

  it("rejects NaN/Infinity from a failed reprojection", () => {
    expect(
      isValidGeographicBounds({ west: NaN, south: 40, east: 5, north: 55 }),
    ).toBe(false);
    expect(
      isValidGeographicBounds({ west: -10, south: 40, east: 5, north: Infinity }),
    ).toBe(false);
  });

  it("rejects south > north", () => {
    expect(
      isValidGeographicBounds({ west: -10, south: 55, east: 5, north: 40 }),
    ).toBe(false);
  });
});
