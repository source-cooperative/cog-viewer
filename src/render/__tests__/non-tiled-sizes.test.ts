import { describe, expect, it } from "vitest";
import {
  computeNonTiledSizes,
  shouldShowBothSizes,
  SIZE_GATE_BYTES,
} from "../non-tiled-sizes";

describe("computeNonTiledSizes", () => {
  it("decoded bytes = width * height * samplesPerPixel * bytesPerSample", () => {
    const sizes = computeNonTiledSizes({
      width: 1000,
      height: 500,
      samplesPerPixel: 3,
      bitsPerSample: 8,
      stripByteCounts: [0],
    });
    expect(sizes.decodedBytes).toBe(1000 * 500 * 3 * 1);
  });

  it("uses bitsPerSample / 8 for float and 16-bit samples", () => {
    const f32 = computeNonTiledSizes({
      width: 100,
      height: 100,
      samplesPerPixel: 1,
      bitsPerSample: 32,
      stripByteCounts: [0],
    });
    expect(f32.decodedBytes).toBe(100 * 100 * 4);

    const u16 = computeNonTiledSizes({
      width: 100,
      height: 100,
      samplesPerPixel: 4,
      bitsPerSample: 16,
      stripByteCounts: [0],
    });
    expect(u16.decodedBytes).toBe(100 * 100 * 4 * 2);
  });

  it("disk bytes = sum of strip byte counts", () => {
    const sizes = computeNonTiledSizes({
      width: 1, height: 1, samplesPerPixel: 1, bitsPerSample: 8,
      stripByteCounts: [100, 200, 300],
    });
    expect(sizes.diskBytes).toBe(600);
  });

  it("handles Uint32Array stripByteCounts", () => {
    const sizes = computeNonTiledSizes({
      width: 1, height: 1, samplesPerPixel: 1, bitsPerSample: 8,
      stripByteCounts: Uint32Array.from([1024, 2048]),
    });
    expect(sizes.diskBytes).toBe(3072);
  });
});

describe("shouldShowBothSizes", () => {
  it("returns true when max / min > 1.5", () => {
    expect(shouldShowBothSizes(100, 200)).toBe(true);
    expect(shouldShowBothSizes(200, 100)).toBe(true);
  });

  it("returns false when ratio <= 1.5", () => {
    expect(shouldShowBothSizes(100, 140)).toBe(false);
    expect(shouldShowBothSizes(100, 100)).toBe(false);
  });

  it("handles zero gracefully", () => {
    expect(shouldShowBothSizes(0, 100)).toBe(true);
    expect(shouldShowBothSizes(0, 0)).toBe(false);
  });
});

describe("SIZE_GATE_BYTES", () => {
  it("is 64 MiB", () => {
    expect(SIZE_GATE_BYTES).toBe(64 * 1024 * 1024);
  });
});
