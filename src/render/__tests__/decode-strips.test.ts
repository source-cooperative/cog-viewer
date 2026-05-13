import {
  Compression,
  PlanarConfiguration,
  Predictor,
  SampleFormat,
  TiffTag,
} from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { decodeStrips, type StripDecoder } from "../decode-strips";

/** Build a stub GeoTIFF that returns canned strip bytes. */
function buildStub(opts: {
  width: number;
  height: number;
  rowsPerStrip: number;
  samplesPerPixel: number;
  stripBytes: ArrayBuffer[];
}) {
  const stripByteCounts = opts.stripBytes.map((b) => b.byteLength);
  return {
    width: opts.width,
    height: opts.height,
    count: opts.samplesPerPixel,
    cachedTags: {
      bitsPerSample: new Uint16Array(
        Array.from({ length: opts.samplesPerPixel }, () => 8),
      ),
      sampleFormat: new Uint16Array(
        Array.from({ length: opts.samplesPerPixel }, () => SampleFormat.Uint),
      ),
      compression: Compression.None,
      predictor: Predictor.None,
      planarConfiguration: PlanarConfiguration.Contig,
    },
    nodata: null,
    image: {
      tags: new Map<number, { count: number; value: unknown }>([
        [
          TiffTag.StripByteCounts,
          { count: stripByteCounts.length, value: stripByteCounts },
        ],
        [TiffTag.RowsPerStrip, { count: 1, value: opts.rowsPerStrip }],
      ]),
      async getStrip(index: number) {
        return {
          mimeType: "application/octet-stream",
          bytes: opts.stripBytes[index],
          compression: Compression.None,
        };
      },
    },
  };
}

describe("decodeStrips", () => {
  it("concatenates uint8 single-band strips into a band-separate raster", async () => {
    // 4 wide × 6 tall, 2 rows per strip → 3 strips, 8 bytes each
    const s1 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    const s2 = Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16]).buffer;
    const s3 = Uint8Array.from([17, 18, 19, 20, 21, 22, 23, 24]).buffer;
    const stub = buildStub({
      width: 4, height: 6, rowsPerStrip: 2, samplesPerPixel: 1,
      stripBytes: [s1, s2, s3],
    });

    // Inject a decoder that just returns the bytes verbatim as Uint8Array.
    const decoder: StripDecoder = async (bytes) => ({
      layout: "band-separate",
      bands: [new Uint8Array(bytes)],
    });

    const result = await decodeStrips(
      stub as unknown as import("@developmentseed/geotiff").GeoTIFF,
      { signal: new AbortController().signal, decoder },
    );

    expect(result.width).toBe(4);
    expect(result.height).toBe(6);
    expect(result.samplesPerPixel).toBe(1);
    expect(result.bands).toHaveLength(1);
    expect(Array.from(result.bands[0])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
      9, 10, 11, 12, 13, 14, 15, 16,
      17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  it("clips the last short strip", async () => {
    // 2 wide × 5 tall, 2 rows per strip → 3 strips: 4 + 4 + 2 bytes
    const s1 = Uint8Array.from([1, 2, 3, 4]).buffer;
    const s2 = Uint8Array.from([5, 6, 7, 8]).buffer;
    const s3 = Uint8Array.from([9, 10]).buffer;
    const stub = buildStub({
      width: 2, height: 5, rowsPerStrip: 2, samplesPerPixel: 1,
      stripBytes: [s1, s2, s3],
    });
    const decoder: StripDecoder = async (bytes) => ({
      layout: "band-separate",
      bands: [new Uint8Array(bytes)],
    });
    const result = await decodeStrips(
      stub as unknown as import("@developmentseed/geotiff").GeoTIFF,
      { signal: new AbortController().signal, decoder },
    );
    expect(result.bands[0].length).toBe(2 * 5);
    expect(Array.from(result.bands[0])).toEqual([1,2,3,4,5,6,7,8,9,10]);
  });

  it("de-interleaves pixel-interleaved strip data into per-band arrays", async () => {
    // 2x2 image, 2 bands, 1 strip with pixel-interleaved layout
    // pixels: (1,2) (3,4) (5,6) (7,8) → band0: [1,3,5,7], band1: [2,4,6,8]
    const strip = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    const stub = buildStub({
      width: 2, height: 2, rowsPerStrip: 2, samplesPerPixel: 2,
      stripBytes: [strip],
    });
    const decoder: StripDecoder = async (bytes) => ({
      layout: "pixel-interleaved",
      data: new Uint8Array(bytes),
    });
    const result = await decodeStrips(
      stub as unknown as import("@developmentseed/geotiff").GeoTIFF,
      { signal: new AbortController().signal, decoder },
    );
    expect(result.bands).toHaveLength(2);
    expect(Array.from(result.bands[0])).toEqual([1, 3, 5, 7]);
    expect(Array.from(result.bands[1])).toEqual([2, 4, 6, 8]);
  });

  it("aborts mid-load when the signal fires", async () => {
    const stub = buildStub({
      width: 2, height: 4, rowsPerStrip: 2, samplesPerPixel: 1,
      stripBytes: [
        Uint8Array.from([1, 2, 3, 4]).buffer,
        Uint8Array.from([5, 6, 7, 8]).buffer,
      ],
    });
    const ac = new AbortController();
    const decoder: StripDecoder = async (bytes) => {
      ac.abort();
      return { layout: "band-separate", bands: [new Uint8Array(bytes)] };
    };
    await expect(
      decodeStrips(
        stub as unknown as import("@developmentseed/geotiff").GeoTIFF,
        { signal: ac.signal, decoder },
      ),
    ).rejects.toThrow(/abort/i);
  });
});
