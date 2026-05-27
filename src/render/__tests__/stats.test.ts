import { describe, expect, it } from "vitest";
import {
  computeStatsFromArrays,
  MAX_SAMPLE_TILES,
  pickSampleCoords,
} from "../stats";

describe("pickSampleCoords", () => {
  it("enumerates every tile when the grid fits under the cap", () => {
    const coords = pickSampleCoords({ x: 4, y: 3 });
    expect(coords).toHaveLength(12);
    expect(new Set(coords.map(([x, y]) => `${x},${y}`)).size).toBe(12);
  });

  it("falls back to a 3x3 spatial sample when the grid exceeds the cap", () => {
    const big = Math.ceil(Math.sqrt(MAX_SAMPLE_TILES)) + 4;
    const coords = pickSampleCoords({ x: big, y: big });
    expect(coords.length).toBeLessThanOrEqual(9);
    const mid = Math.floor(big / 2);
    const expected = new Set([
      `0,0`, `${mid},0`, `${big - 1},0`,
      `0,${mid}`, `${mid},${mid}`, `${big - 1},${mid}`,
      `0,${big - 1}`, `${mid},${big - 1}`, `${big - 1},${big - 1}`,
    ]);
    for (const [x, y] of coords) {
      expect(expected.has(`${x},${y}`)).toBe(true);
    }
  });

  it("dedupes when grid dimensions collapse the sample positions", () => {
    expect(pickSampleCoords({ x: 1, y: 1 })).toEqual([[0, 0]]);
  });

  it("returns no coordinates for an empty grid", () => {
    expect(pickSampleCoords({ x: 0, y: 5 })).toEqual([]);
    expect(pickSampleCoords({ x: 5, y: 0 })).toEqual([]);
  });
});

describe("computeStatsFromArrays", () => {
  it("derives per-band min/max from the samples when no priors", () => {
    const bands = [
      Int16Array.from([0, 5, 10, 10]),
      Int16Array.from([100, 200, 300, 400]),
    ];
    const stats = computeStatsFromArrays(bands, null, null);
    expect(stats.perBand?.get(1)).toMatchObject({ min: 0, max: 10 });
    expect(stats.perBand?.get(2)).toMatchObject({ min: 100, max: 400 });
    // Histogram bin counts sum to the number of (non-nodata) samples.
    const total = stats.perBand
      ?.get(1)
      ?.histogram.reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });

  it("excludes nodata samples from min/max and the histogram", () => {
    const bands = [Int16Array.from([-9999, 1, 2, 3, -9999])];
    const stats = computeStatsFromArrays(bands, -9999, null);
    expect(stats.perBand?.get(1)).toMatchObject({ min: 1, max: 3 });
    const total = stats.perBand
      ?.get(1)
      ?.histogram.reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  it("anchors bin edges to author-supplied priors when present", () => {
    const bands = [Int16Array.from([10, 20, 30])];
    const priors = new Map([[1, { min: 0, max: 100 }]]);
    const stats = computeStatsFromArrays(bands, null, priors);
    // Range comes from the prior, not the samples.
    expect(stats.perBand?.get(1)).toMatchObject({ min: 0, max: 100 });
  });

  it("drops degenerate bands (all nodata / single value) and returns null stats", () => {
    const bands = [Int16Array.from([7, 7, 7])];
    const stats = computeStatsFromArrays(bands, null, null);
    expect(stats.perBand).toBeNull();
  });
});
