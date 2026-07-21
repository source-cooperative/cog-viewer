import { describe, expect, it } from "vitest";
import { humanizeError } from "../Toast";

describe("humanizeError", () => {
  it("explains CORS / network failures", () => {
    expect(humanizeError(new Error("Failed to fetch"))).toMatch(/cross-origin/i);
    expect(humanizeError(new TypeError("NetworkError when attempting"))).toMatch(
      /cross-origin/i,
    );
  });

  it("flags non-TIFF files, including Parquet (bogus 'supported version')", () => {
    const msg = "This file does not look like a valid Cloud Optimized GeoTIFF.";
    expect(humanizeError(new Error("Not a TIFF file"))).toBe(msg);
    // @cogeotiff/core's message for a Parquet file loaded as a COG.
    expect(humanizeError(new Error("Only tiff supported version:21040"))).toBe(msg);
  });

  it("flags projections it can't display", () => {
    expect(
      humanizeError(new Error("Unsupported coordinate transformation type: 28")),
    ).toMatch(/projection this viewer can't display/i);
    expect(humanizeError(new Error("Unsupported GeoTIFF model type: 0"))).toMatch(
      /projection this viewer can't display/i,
    );
    expect(
      humanizeError(new Error("Could not get projection name from: [object Object]")),
    ).toMatch(/projection this viewer can't display/i);
  });

  it("surfaces 404s", () => {
    expect(humanizeError(new Error("Request failed 404"))).toMatch(/404/);
  });

  it("falls back to the raw message otherwise", () => {
    expect(humanizeError(new Error("boom"))).toBe("Could not load the COG: boom");
    expect(humanizeError("plain string")).toBe("Could not load the COG: plain string");
  });
});
