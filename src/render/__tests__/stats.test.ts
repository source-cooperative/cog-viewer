import { describe, expect, it } from "vitest";
import { MAX_SAMPLE_TILES, pickSampleCoords } from "../stats";

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
